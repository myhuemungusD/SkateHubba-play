import { Timestamp, collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";

/**
 * Schema version for the GDPR Article 20 data export bundle. Increment when
 * the shape of `UserDataExport` changes so consumers can detect an
 * incompatible dump.
 */
export const USER_DATA_EXPORT_SCHEMA_VERSION = 1 as const;

/**
 * Shape of a single Firestore doc included in the export. The payload is
 * whatever Firestore returned, post-normalisation: Timestamps become ISO
 * strings so the JSON round-trips cleanly.
 */
export interface ExportedDoc {
  id: string;
  path: string;
  data: Record<string, unknown>;
}

/**
 * Full GDPR Article 20 data bundle for one user.
 *
 * Covers every collection where the user is a principal author or subject:
 *   - `users/{uid}`                    — their profile
 *   - `usernames/{username}`           — their reservation
 *   - `games` (player1Uid|player2Uid)  — full game docs they played in
 *   - `clips` (playerUid == uid)       — landed-trick clips they authored
 *   - `users/{uid}/blocked_users/*`    — people they have blocked
 *   - `reports` (reporterUid == uid)   — reports they filed
 *
 * Intentionally excludes:
 *   - Other users' profile/game data (not the exporter's data)
 *   - Video binaries (linked via `videoUrl`; download separately if needed)
 *   - Server-side analytics that don't identify this user
 */
export interface UserDataExport {
  schemaVersion: typeof USER_DATA_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  subject: {
    uid: string;
    username: string;
  };
  profile: ExportedDoc | null;
  usernameReservation: ExportedDoc | null;
  games: ExportedDoc[];
  clips: ExportedDoc[];
  blockedUsers: ExportedDoc[];
  reports: ExportedDoc[];
}

/**
 * Recursively replace Firestore Timestamps with ISO strings so the export
 * round-trips through JSON.stringify cleanly. Firestore's Timestamp class
 * serialises as `{seconds, nanoseconds}` which is valid JSON but opaque to
 * humans reading the dump.
 */
function normalizeTimestamps(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeTimestamps);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalizeTimestamps(v);
    }
    return out;
  }
  return value;
}

function toExportedDoc(id: string, path: string, data: unknown): ExportedDoc {
  const normalized = normalizeTimestamps(data);
  // Firestore's data() always returns an object when exists() is true, but
  // tests may pass anything through — coerce non-objects to {} so the
  // ExportedDoc shape is predictable.
  const asObject = normalized && typeof normalized === "object" ? (normalized as Record<string, unknown>) : {};
  return { id, path, data: asObject };
}

/**
 * Collect every piece of personal data we hold about `uid`/`username` into a
 * single bundle suitable for GDPR Article 20 / CCPA data-portability
 * requests.
 *
 * Each collection is queried independently and best-effort: if one read
 * fails we log and return an empty list for that collection rather than
 * aborting the whole export. That keeps partial dumps valid — users can
 * retry to fill in missing surfaces.
 *
 * Firestore security rules still apply; this function must be called while
 * authenticated AS `uid` so the same rules that protect normal reads also
 * protect the export.
 */
export async function exportUserData(uid: string, username: string): Promise<UserDataExport> {
  if (!uid) throw new Error("exportUserData requires a uid");
  const normalizedUsername = username.toLowerCase().trim();
  const db = requireDb();

  const [profile, usernameReservation, gamesAsP1, gamesAsP2, clips, blocked, reports] = await Promise.all([
    readDoc(`users/${uid}`, () => getDoc(doc(db, "users", uid))),
    normalizedUsername
      ? readDoc(`usernames/${normalizedUsername}`, () => getDoc(doc(db, "usernames", normalizedUsername)))
      : Promise.resolve(null),
    readCollection("games (player1)", () => getDocs(query(collection(db, "games"), where("player1Uid", "==", uid)))),
    readCollection("games (player2)", () => getDocs(query(collection(db, "games"), where("player2Uid", "==", uid)))),
    readCollection("clips", () => getDocs(query(collection(db, "clips"), where("playerUid", "==", uid)))),
    readCollection("blocked_users", () => getDocs(collection(db, "users", uid, "blocked_users"))),
    readCollection("reports", () => getDocs(query(collection(db, "reports"), where("reporterUid", "==", uid)))),
  ]);

  // Deduplicate games — a user can only be player1 OR player2, but surface any
  // overlap defensively in case of historical rows.
  const seenGames = new Set<string>();
  const games: ExportedDoc[] = [];
  for (const d of [...gamesAsP1, ...gamesAsP2]) {
    if (!seenGames.has(d.id)) {
      seenGames.add(d.id);
      games.push(d);
    }
  }

  return {
    schemaVersion: USER_DATA_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    subject: { uid, username: normalizedUsername },
    profile,
    usernameReservation,
    games,
    clips,
    blockedUsers: blocked,
    reports,
  };
}

async function readDoc(
  path: string,
  fetcher: () => Promise<{ exists(): boolean; id: string; data(): unknown }>,
): Promise<ExportedDoc | null> {
  try {
    const snap = await withRetry(fetcher);
    if (!snap.exists()) return null;
    return toExportedDoc(snap.id, path, snap.data());
  } catch (err) {
    logger.warn("user_data_export_doc_failed", { path, error: parseFirebaseError(err) });
    return null;
  }
}

async function readCollection(
  label: string,
  fetcher: () => Promise<{ docs: Array<{ id: string; ref: { path: string }; data(): unknown }> }>,
): Promise<ExportedDoc[]> {
  try {
    const snap = await withRetry(fetcher);
    return snap.docs.map((d) => toExportedDoc(d.id, d.ref.path, d.data()));
  } catch (err) {
    logger.warn("user_data_export_collection_failed", { label, error: parseFirebaseError(err) });
    return [];
  }
}

/** Pretty-printed JSON serialisation of the export bundle. */
export function serializeUserData(bundle: UserDataExport): string {
  return JSON.stringify(bundle, null, 2);
}

/**
 * Build the filename used when the user saves the export locally. Includes
 * the username and ISO date so multiple exports don't clobber each other.
 */
export function userDataFilename(bundle: UserDataExport): string {
  const safeUsername = bundle.subject.username.replace(/[^a-z0-9_-]/gi, "") || "user";
  const date = bundle.exportedAt.slice(0, 10); // YYYY-MM-DD
  return `skatehubba-data-${safeUsername}-${date}.json`;
}
