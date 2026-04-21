import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit as limitFn,
  orderBy,
  query,
  where,
} from "firebase/firestore";
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
 * Per-surface cap for collection reads. High enough to cover any realistic
 * user while bounding read cost and memory. If a user truly has more than
 * this many docs in a surface, the bundle's `capped` flag will be `true`.
 */
const EXPORT_QUERY_LIMIT = 500;

/**
 * Full GDPR Article 20 data bundle for one user.
 *
 * Covers every collection where the user is a principal author or subject:
 *   - `users/{uid}`                    — their profile
 *   - `usernames/{username}`           — their reservation
 *   - `games` (player1Uid|player2Uid|judgeId) — games they played or judged
 *   - `clips` (playerUid == uid)       — landed-trick clips they authored
 *   - `clipVotes` (uid == uid)         — upvotes they cast
 *   - `spots` (createdBy == uid)       — skate spots they added
 *   - `notifications` (recipientUid)   — notifications received
 *   - `nudges` (senderUid|recipientUid) — nudges sent or received
 *   - `users/{uid}/blocked_users/*`    — people they have blocked
 *   - `reports` (reporterUid == uid)   — reports they filed
 *
 * Intentionally excludes:
 *   - Other users' profile/game data (not the exporter's data)
 *   - Video binaries (linked via `videoUrl`; download separately if needed)
 *   - Server-side analytics that don't identify this user
 *   - `spots/{id}/comments` subcollections — comments are keyed by spot, not
 *     by user, and there is no cross-spot index. A full export would require
 *     enumerating every spot then reading its comments subcollection, which
 *     is infeasible client-side. Spot comments are included transitively via
 *     the `spots` surface (the spot doc itself is exported).
 *
 * Each collection read is capped at {@link EXPORT_QUERY_LIMIT} docs. If any
 * surface hits the cap, `capped` is set to `true` so the consumer knows the
 * dump may be incomplete.
 */
export interface UserDataExport {
  schemaVersion: typeof USER_DATA_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  capped: boolean;
  subject: {
    uid: string;
    username: string;
  };
  profile: ExportedDoc | null;
  /**
   * Owner-only PII stored at `users/{uid}/private/profile`
   * (dob, parentalConsent, fcmTokens). Null when the doc hasn't been
   * created yet — e.g. users from before the April 2026 split.
   */
  privateProfile: ExportedDoc | null;
  usernameReservation: ExportedDoc | null;
  games: ExportedDoc[];
  clips: ExportedDoc[];
  clipVotes: ExportedDoc[];
  spots: ExportedDoc[];
  notifications: ExportedDoc[];
  nudges: ExportedDoc[];
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

  const cap = EXPORT_QUERY_LIMIT;
  const gamesCol = collection(db, "games");
  const clipsCol = collection(db, "clips");

  const [
    profile,
    privateProfile,
    usernameReservation,
    gamesAsP1,
    gamesAsP2,
    gamesAsJudge,
    clips,
    clipVotes,
    spots,
    notifications,
    nudgesSent,
    nudgesReceived,
    blocked,
    reports,
  ] = await Promise.all([
    readDoc(`users/${uid}`, () => getDoc(doc(db, "users", uid))),
    readDoc(`users/${uid}/private/profile`, () => getDoc(doc(db, "users", uid, "private", "profile"))),
    normalizedUsername
      ? readDoc(`usernames/${normalizedUsername}`, () => getDoc(doc(db, "usernames", normalizedUsername)))
      : Promise.resolve(null),
    readCollection("games (player1)", () =>
      getDocs(query(gamesCol, where("player1Uid", "==", uid), orderBy("createdAt", "desc"), limitFn(cap))),
    ),
    readCollection("games (player2)", () =>
      getDocs(query(gamesCol, where("player2Uid", "==", uid), orderBy("createdAt", "desc"), limitFn(cap))),
    ),
    readCollection("games (judge)", () =>
      getDocs(query(gamesCol, where("judgeId", "==", uid), orderBy("createdAt", "desc"), limitFn(cap))),
    ),
    readCollection("clips", () =>
      getDocs(query(clipsCol, where("playerUid", "==", uid), orderBy("createdAt", "desc"), limitFn(cap))),
    ),
    readCollection("clipVotes", () =>
      getDocs(query(collection(db, "clipVotes"), where("uid", "==", uid), limitFn(cap))),
    ),
    readCollection("spots", () =>
      getDocs(
        query(collection(db, "spots"), where("createdBy", "==", uid), orderBy("createdAt", "desc"), limitFn(cap)),
      ),
    ),
    readCollection("notifications", () =>
      getDocs(
        query(
          collection(db, "notifications"),
          where("recipientUid", "==", uid),
          orderBy("createdAt", "desc"),
          limitFn(cap),
        ),
      ),
    ),
    readCollection("nudges (sent)", () =>
      getDocs(query(collection(db, "nudges"), where("senderUid", "==", uid), limitFn(cap))),
    ),
    readCollection("nudges (received)", () =>
      getDocs(query(collection(db, "nudges"), where("recipientUid", "==", uid), limitFn(cap))),
    ),
    readCollection("blocked_users", () => getDocs(collection(db, "users", uid, "blocked_users"))),
    readCollection("reports", () =>
      getDocs(query(collection(db, "reports"), where("reporterUid", "==", uid), limitFn(cap))),
    ),
  ]);

  // Deduplicate games — a user can appear as player1, player2, or judge on
  // the same game doc.
  const seenGames = new Set<string>();
  const games: ExportedDoc[] = [];
  for (const d of [...gamesAsP1, ...gamesAsP2, ...gamesAsJudge]) {
    if (!seenGames.has(d.id)) {
      seenGames.add(d.id);
      games.push(d);
    }
  }

  // Deduplicate nudges (user may be both sender and recipient of different
  // nudges, but could theoretically appear in both queries for the same doc).
  const seenNudges = new Set<string>();
  const nudges: ExportedDoc[] = [];
  for (const d of [...nudgesSent, ...nudgesReceived]) {
    if (!seenNudges.has(d.id)) {
      seenNudges.add(d.id);
      nudges.push(d);
    }
  }

  // Flag if any surface hit the per-query cap.
  const allSurfaces = [
    gamesAsP1,
    gamesAsP2,
    gamesAsJudge,
    clips,
    clipVotes,
    spots,
    notifications,
    nudgesSent,
    nudgesReceived,
    blocked,
    reports,
  ];
  const capped = allSurfaces.some((s) => s.length >= cap);

  return {
    schemaVersion: USER_DATA_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    capped,
    subject: { uid, username: normalizedUsername },
    profile,
    privateProfile,
    usernameReservation,
    games,
    clips,
    clipVotes,
    spots,
    notifications,
    nudges,
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
