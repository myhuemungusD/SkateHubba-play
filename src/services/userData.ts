import { Timestamp, doc, getDoc, getDocs } from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import type { SaveFileResult } from "./nativeBridge";
import { EXPORT_QUERY_LIMIT, exportCollectionQueries } from "./userDataQueries";

/**
 * Schema version for the GDPR Article 20 data export bundle. Increment when
 * the shape of `UserDataExport` changes so consumers can detect an
 * incompatible dump.
 *
 * v2: added `complete`, `missingSections` and `notice`, so a file that is
 * missing a section says so instead of looking like the user has no data.
 */
export const USER_DATA_EXPORT_SCHEMA_VERSION = 2 as const;

/** Where to write if an export keeps coming back incomplete. */
const PRIVACY_CONTACT_EMAIL = "privacy@skatehubba.com";

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

/** Bundle sections that hold the user's data (everything but metadata). */
export type ExportSection =
  | "profile"
  | "usernameReservation"
  | "games"
  | "clips"
  | "clipVotes"
  | "spots"
  | "notifications"
  | "nudges"
  | "blockedUsers"
  | "reports"
  | "moderationStatements"
  | "appeals";

/** Plain-words names for each section, used in the file notice and the UI. */
const SECTION_NAMES: Record<ExportSection, string> = {
  profile: "profile",
  usernameReservation: "username",
  games: "game history",
  clips: "clips",
  clipVotes: "clip votes",
  spots: "spots you added",
  notifications: "notifications",
  nudges: "nudges",
  blockedUsers: "blocked users list",
  reports: "reports you filed",
  moderationStatements: "moderation notices",
  appeals: "appeals",
};

/** Fixed order so the missing list reads the same way every time. */
const SECTION_ORDER = Object.keys(SECTION_NAMES) as ExportSection[];

/**
 * Full GDPR Article 20 data bundle for one user.
 *
 * Covers every collection where the user is a principal author or subject:
 *   - `users/{uid}`                    — their profile
 *   - `usernames/{username}`           — their reservation
 *   - `games` (player1Uid|player2Uid|judgeId) — games they played or judged
 *   - `clips` (playerUid == uid)       — clips they authored
 *   - `clipVotes` (uid == uid)         — votes they cast
 *   - `spots` (createdBy == uid, isActive) — skate spots they added that are
 *                                        still live (rules hide removed ones)
 *   - `notifications` (recipientUid)   — notifications received
 *   - `nudges` (senderUid|recipientUid) — nudges sent or received
 *   - `users/{uid}/blocked_users/*`    — people they have blocked
 *   - `reports` (reporterUid == uid)   — reports they filed
 *   - `moderationStatements` (subjectUid) — statements of reasons about them
 *   - `appeals` (appellantUid == uid)  — appeals they filed
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
 * dump may be incomplete. Lists are newest first by `createdAt`.
 *
 * If a read fails, its section is left empty AND named in `missingSections`,
 * `complete` is `false`, and `notice` explains it in plain words. An empty
 * list in a complete file means "nothing stored", never "couldn't read it".
 */
export interface UserDataExport {
  schemaVersion: typeof USER_DATA_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  /** False when at least one section could not be read. */
  complete: boolean;
  /** Sections that could not be read this time (empty when complete). */
  missingSections: ExportSection[];
  /** Plain-words explanation, present only when the file is incomplete. */
  notice?: string;
  capped: boolean;
  subject: {
    uid: string;
    username: string;
  };
  profile: ExportedDoc | null;
  usernameReservation: ExportedDoc | null;
  games: ExportedDoc[];
  clips: ExportedDoc[];
  clipVotes: ExportedDoc[];
  spots: ExportedDoc[];
  notifications: ExportedDoc[];
  nudges: ExportedDoc[];
  blockedUsers: ExportedDoc[];
  reports: ExportedDoc[];
  moderationStatements: ExportedDoc[];
  appeals: ExportedDoc[];
}

/**
 * What "Download my data" hands back to the screen: how the file was saved
 * and which sections it is missing, so the UI can say so.
 */
export interface DataDownloadOutcome {
  saved: SaveFileResult;
  missingSections: ExportSection[];
}

/** "game history", "game history and clips", "a, b and c". */
export function describeMissingSections(sections: readonly ExportSection[]): string {
  const names = sections.map((s) => SECTION_NAMES[s]);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
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

/** Millisecond sort key for a doc's `createdAt` (ISO string after normalising). */
function createdAtMillis(d: ExportedDoc): number {
  const v = d.data.createdAt;
  const ms = typeof v === "string" ? Date.parse(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/**
 * Newest first by `createdAt`, done here because the queries can't `orderBy`
 * without composite indexes (see userDataQueries.ts). Docs without a usable
 * `createdAt` go last; ties keep query order.
 */
function sortNewestFirst(docs: ExportedDoc[]): ExportedDoc[] {
  return [...docs].sort((x, y) => {
    const a = createdAtMillis(x);
    const b = createdAtMillis(y);
    if (a === b) return 0;
    return a > b ? -1 : 1;
  });
}

/** Merge lists that can return the same doc, keeping the first copy. */
function dedupe(...lists: ExportedDoc[][]): ExportedDoc[] {
  const seen = new Set<string>();
  const out: ExportedDoc[] = [];
  for (const d of lists.flat()) {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      out.push(d);
    }
  }
  return out;
}

interface Read<T> {
  value: T;
  ok: boolean;
}

/**
 * Collect every piece of personal data we hold about `uid`/`username` into a
 * single bundle suitable for GDPR Article 20 / CCPA data-portability
 * requests.
 *
 * Each collection is queried independently: if one read fails the others
 * still land, and the failed section is named in `missingSections` (with a
 * plain `notice`) rather than silently exported as empty. The user can retry
 * to fill it in.
 *
 * Firestore security rules still apply; this function must be called while
 * authenticated AS `uid` so the same rules that protect normal reads also
 * protect the export.
 */
export async function exportUserData(uid: string, username: string): Promise<UserDataExport> {
  if (!uid) throw new Error("exportUserData requires a uid");
  const normalizedUsername = username.toLowerCase().trim();
  const db = requireDb();
  const q = exportCollectionQueries(db, uid);

  const [
    profile,
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
    moderationStatements,
    appeals,
  ] = await Promise.all([
    readDoc(`users/${uid}`, () => getDoc(doc(db, "users", uid))),
    normalizedUsername
      ? readDoc(`usernames/${normalizedUsername}`, () => getDoc(doc(db, "usernames", normalizedUsername)))
      : Promise.resolve<Read<ExportedDoc | null>>({ value: null, ok: true }),
    readCollection("games (player1)", () => getDocs(q.gamesAsPlayer1)),
    readCollection("games (player2)", () => getDocs(q.gamesAsPlayer2)),
    readCollection("games (judge)", () => getDocs(q.gamesAsJudge)),
    readCollection("clips", () => getDocs(q.clips)),
    readCollection("clipVotes", () => getDocs(q.clipVotes)),
    readCollection("spots", () => getDocs(q.spots)),
    readCollection("notifications", () => getDocs(q.notifications)),
    readCollection("nudges (sent)", () => getDocs(q.nudgesSent)),
    readCollection("nudges (received)", () => getDocs(q.nudgesReceived)),
    readCollection("blocked_users", () => getDocs(q.blockedUsers)),
    readCollection("reports", () => getDocs(q.reports)),
    readCollection("moderationStatements", () => getDocs(q.moderationStatements)),
    readCollection("appeals", () => getDocs(q.appeals)),
  ]);

  // A section is missing if any read that feeds it failed.
  const sectionReads: Record<ExportSection, Read<unknown>[]> = {
    profile: [profile],
    usernameReservation: [usernameReservation],
    games: [gamesAsP1, gamesAsP2, gamesAsJudge],
    clips: [clips],
    clipVotes: [clipVotes],
    spots: [spots],
    notifications: [notifications],
    nudges: [nudgesSent, nudgesReceived],
    blockedUsers: [blocked],
    reports: [reports],
    moderationStatements: [moderationStatements],
    appeals: [appeals],
  };
  const missingSections = SECTION_ORDER.filter((s) => sectionReads[s].some((r) => !r.ok));

  // Flag if any surface hit the per-query cap.
  const lists = [
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
    moderationStatements,
    appeals,
  ];
  const capped = lists.some((r) => r.value.length >= EXPORT_QUERY_LIMIT);

  const complete = missingSections.length === 0;
  return {
    schemaVersion: USER_DATA_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    complete,
    missingSections,
    ...(complete
      ? {}
      : {
          notice:
            `Some of your data is missing from this file: your ${describeMissingSections(missingSections)}. ` +
            "We couldn't load it this time, so those sections are empty even if you have data there. " +
            `Download your data again in a few minutes. If it keeps happening, email ${PRIVACY_CONTACT_EMAIL}.`,
        }),
    capped,
    subject: { uid, username: normalizedUsername },
    profile: profile.value,
    usernameReservation: usernameReservation.value,
    // A user can be player1, player2 or judge on the same game doc.
    games: sortNewestFirst(dedupe(gamesAsP1.value, gamesAsP2.value, gamesAsJudge.value)),
    clips: sortNewestFirst(clips.value),
    clipVotes: sortNewestFirst(clipVotes.value),
    spots: sortNewestFirst(spots.value),
    notifications: sortNewestFirst(notifications.value),
    // Sent and received can't overlap today, but dedupe keeps one copy if a
    // self-nudge ever slips through.
    nudges: sortNewestFirst(dedupe(nudgesSent.value, nudgesReceived.value)),
    blockedUsers: blocked.value,
    reports: sortNewestFirst(reports.value),
    moderationStatements: sortNewestFirst(moderationStatements.value),
    appeals: sortNewestFirst(appeals.value),
  };
}

async function readDoc(
  path: string,
  fetcher: () => Promise<{ exists(): boolean; id: string; data(): unknown }>,
): Promise<Read<ExportedDoc | null>> {
  try {
    const snap = await withRetry(fetcher);
    if (!snap.exists()) return { value: null, ok: true };
    return { value: toExportedDoc(snap.id, path, snap.data()), ok: true };
  } catch (err) {
    logger.warn("user_data_export_doc_failed", { path, error: parseFirebaseError(err) });
    return { value: null, ok: false };
  }
}

async function readCollection(
  label: string,
  fetcher: () => Promise<{ docs: Array<{ id: string; ref: { path: string }; data(): unknown }> }>,
): Promise<Read<ExportedDoc[]>> {
  try {
    const snap = await withRetry(fetcher);
    return { value: snap.docs.map((d) => toExportedDoc(d.id, d.ref.path, d.data())), ok: true };
  } catch (err) {
    logger.warn("user_data_export_collection_failed", { label, error: parseFirebaseError(err) });
    return { value: [], ok: false };
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
