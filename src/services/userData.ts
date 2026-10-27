import { Timestamp, doc, getDocFromServer, getDocsFromServer, type Query } from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { logger } from "./logger";
import { captureMessage } from "../lib/sentry";
import { getErrorCode } from "../utils/helpers";
import { EXPORT_MAX_PAGES, EXPORT_PAGE_SIZE, exportCollectionQueries, exportNextPage } from "./userDataQueries";

/**
 * Schema version for the GDPR Article 20 data export bundle. Increment when
 * the shape of `UserDataExport` changes so consumers can detect an
 * incompatible dump.
 *
 * v2: added `complete`, `missingSections`, `truncatedSections` and `notice`,
 * so a file that is missing data says so instead of looking like the user
 * has none.
 */
export const USER_DATA_EXPORT_SCHEMA_VERSION = 2 as const;

/** Where to write if an export keeps coming back incomplete. */
export const PRIVACY_CONTACT_EMAIL = "privacy@skatehubba.com";

/** Most docs one list can hold in the file (pages × page size). */
export const EXPORT_MAX_DOCS_PER_LIST = EXPORT_MAX_PAGES * EXPORT_PAGE_SIZE;

/** Shown when no section at all could be read, so no file is made. */
export const EXPORT_FAILED_MESSAGE = "We couldn't load your data. Check your connection and try again.";

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
  spots: "spots",
  notifications: "notifications",
  nudges: "nudges",
  blockedUsers: "blocked list",
  reports: "reports",
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
 *   - `spots` (createdBy == uid, isActive) — skate spots they added. Rules
 *                                        only allow reading active spots, so
 *                                        a spot an admin or moderator
 *                                        deactivated is left out (users can
 *                                        only hard-delete their own spots)
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
 * Every read goes to the server (`getDocFromServer` / `getDocsFromServer`),
 * never the offline cache, so a file can't say "complete" while holding only
 * what happened to be cached. Lists are read page by page up to
 * {@link EXPORT_MAX_DOCS_PER_LIST} docs and sorted newest first by
 * `createdAt`.
 *
 * If a read fails, its section is named in `missingSections`. If a list is
 * longer than the ceiling, it is named in `truncatedSections`. Either way
 * `complete` is `false` and `notice` explains it in plain words. An empty
 * list in a complete file means "nothing stored", never "couldn't read it".
 */
export interface UserDataExport {
  schemaVersion: typeof USER_DATA_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  /** False when a section could not be read or was too long to include in full. */
  complete: boolean;
  /** Sections that could not be read (in full) this time. */
  missingSections: ExportSection[];
  /** Lists longer than {@link EXPORT_MAX_DOCS_PER_LIST}; the file holds the first part. */
  truncatedSections: ExportSection[];
  /** Plain-words explanation, present only when the file is incomplete. */
  notice?: string;
  /** Same as `truncatedSections.length > 0`; kept for v1 readers. */
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
 * What "Download my data" hands back to the screen: which sections the saved
 * file is missing, so the UI can say so.
 */
export interface DataDownloadOutcome {
  missingSections: ExportSection[];
  truncatedSections: ExportSection[];
}

/** "game history", "game history and clips", "a, b and c". */
export function describeMissingSections(sections: readonly ExportSection[]): string {
  const names = sections.map((s) => SECTION_NAMES[s]);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Plain-words explanation of an incomplete export, shared by the file's
 * `notice` and the on-screen warning. Empty when nothing is missing.
 */
export function describeIncompleteExport(
  missingSections: readonly ExportSection[],
  truncatedSections: readonly ExportSection[],
): string {
  const parts: string[] = [];
  if (missingSections.length > 0) {
    parts.push(
      `We couldn't load all of your ${describeMissingSections(missingSections)} this time, ` +
        "so that part of the file may be empty or incomplete. Try again in a few minutes.",
    );
  }
  if (truncatedSections.length > 0) {
    parts.push(
      `Your ${describeMissingSections(truncatedSections)} ${truncatedSections.length === 1 ? "has" : "have"} ` +
        `more than ${EXPORT_MAX_DOCS_PER_LIST.toLocaleString("en-US")} items, so the file holds the first ` +
        `${EXPORT_MAX_DOCS_PER_LIST.toLocaleString("en-US")}.`,
    );
  }
  if (parts.length === 0) return "";
  parts.push(`If you need a complete copy, email ${PRIVACY_CONTACT_EMAIL}.`);
  return parts.join(" ");
}

/** Thrown when no section at all could be read: there is no file worth saving. */
export class UserDataExportError extends Error {
  /** Firestore error code per failed read, for Sentry. No personal data. */
  readonly codes: Record<string, string>;
  constructor(codes: Record<string, string>) {
    super(EXPORT_FAILED_MESSAGE);
    this.name = "UserDataExportError";
    this.codes = codes;
  }
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

/** One read: its value, whether it worked, and the error code if not. */
/** One read's result. A failed read keeps what it got and its error code. */
type Read<T> =
  | {
      value: T;
      ok: true;
      /** True when a list hit {@link EXPORT_MAX_PAGES} with more still to read. */
      truncated?: boolean;
    }
  | { value: T; ok: false; code: string };

/** Labels for each read. Fixed strings only: never a uid, username or path. */
type ReadLabel =
  | "profile"
  | "usernameReservation"
  | "gamesAsPlayer1"
  | "gamesAsPlayer2"
  | "gamesAsJudge"
  | "clips"
  | "clipVotes"
  | "spots"
  | "notifications"
  | "nudgesSent"
  | "nudgesReceived"
  | "blockedUsers"
  | "reports"
  | "moderationStatements"
  | "appeals";

/**
 * Collect every piece of personal data we hold about `uid`/`username` into a
 * single bundle suitable for GDPR Article 20 / CCPA data-portability
 * requests.
 *
 * Each collection is queried independently: if one read fails the others
 * still land, and the failed section is named in `missingSections` (with a
 * plain `notice`) rather than silently exported as empty. The user can retry
 * to fill it in. If every read fails, this throws {@link UserDataExportError}
 * instead of producing a near-empty file.
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
    readDoc("profile", `users/${uid}`, () => getDocFromServer(doc(db, "users", uid))),
    normalizedUsername
      ? readDoc("usernameReservation", `usernames/${normalizedUsername}`, () =>
          getDocFromServer(doc(db, "usernames", normalizedUsername)),
        )
      : null,
    readCollection("gamesAsPlayer1", q.gamesAsPlayer1),
    readCollection("gamesAsPlayer2", q.gamesAsPlayer2),
    readCollection("gamesAsJudge", q.gamesAsJudge),
    readCollection("clips", q.clips),
    readCollection("clipVotes", q.clipVotes),
    readCollection("spots", q.spots),
    readCollection("notifications", q.notifications),
    readCollection("nudgesSent", q.nudgesSent),
    readCollection("nudgesReceived", q.nudgesReceived),
    readCollection("blockedUsers", q.blockedUsers),
    readCollection("reports", q.reports),
    readCollection("moderationStatements", q.moderationStatements),
    readCollection("appeals", q.appeals),
  ]);

  // A blank username means there is no reservation to read: not a failure.
  const reservation: Read<ExportedDoc | null> = usernameReservation ?? { value: null, ok: true };

  const readsByLabel: Array<[ReadLabel, Read<unknown>]> = [
    ["profile", profile],
    ...(usernameReservation ? [["usernameReservation", usernameReservation] as [ReadLabel, Read<unknown>]] : []),
    ["gamesAsPlayer1", gamesAsP1],
    ["gamesAsPlayer2", gamesAsP2],
    ["gamesAsJudge", gamesAsJudge],
    ["clips", clips],
    ["clipVotes", clipVotes],
    ["spots", spots],
    ["notifications", notifications],
    ["nudgesSent", nudgesSent],
    ["nudgesReceived", nudgesReceived],
    ["blockedUsers", blocked],
    ["reports", reports],
    ["moderationStatements", moderationStatements],
    ["appeals", appeals],
  ];
  const codes: Record<string, string> = {};
  for (const [label, r] of readsByLabel) if (!r.ok) codes[label] = r.code;

  // Nothing could be read at all (offline, signed out): no file is better
  // than a near-empty one with every section flagged.
  if (readsByLabel.every(([, r]) => !r.ok)) {
    throw new UserDataExportError(codes);
  }

  // A section is missing if any read that feeds it failed, and truncated if
  // any list that feeds it hit the page ceiling.
  const sectionReads: Record<ExportSection, Read<unknown>[]> = {
    profile: [profile],
    usernameReservation: [reservation],
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
  const truncatedSections = SECTION_ORDER.filter((s) => sectionReads[s].some((r) => r.ok && r.truncated));

  const complete = missingSections.length === 0 && truncatedSections.length === 0;
  if (!complete) {
    // Ops signal for partial exports. Section names and error codes only.
    captureMessage("user_data_export_partial", {
      level: "warning",
      extra: { missingSections, truncatedSections, codes },
    });
  }
  return {
    schemaVersion: USER_DATA_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    complete,
    missingSections,
    truncatedSections,
    ...(complete
      ? {}
      : {
          notice: `Some of your data is missing from this file. ${describeIncompleteExport(missingSections, truncatedSections)}`,
        }),
    capped: truncatedSections.length > 0,
    subject: { uid, username: normalizedUsername },
    profile: profile.value,
    usernameReservation: reservation.value,
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

/** Error code for logs and Sentry; never the message, which can carry a path. */
function codeOf(err: unknown): string {
  return getErrorCode(err) || "unknown";
}

async function readDoc(
  label: ReadLabel,
  path: string,
  fetcher: () => Promise<{ exists(): boolean; id: string; data(): unknown }>,
): Promise<Read<ExportedDoc | null>> {
  try {
    const snap = await withRetry(fetcher);
    if (!snap.exists()) return { value: null, ok: true };
    return { value: toExportedDoc(snap.id, path, snap.data()), ok: true };
  } catch (err) {
    const code = codeOf(err);
    logger.warn("user_data_export_doc_failed", { section: label, code });
    return { value: null, ok: false, code };
  }
}

/**
 * Read every page of one export query from the server. Stops when a page
 * comes back short, or at {@link EXPORT_MAX_PAGES} (then `truncated`). If a
 * page fails, the docs read so far are kept and the read is marked failed.
 */
async function readCollection(label: ReadLabel, first: Query): Promise<Read<ExportedDoc[]>> {
  const docs: ExportedDoc[] = [];
  let page = first;
  try {
    for (let n = 1; ; n++) {
      const snap = await withRetry(() => getDocsFromServer(page));
      for (const d of snap.docs) docs.push(toExportedDoc(d.id, d.ref.path, d.data()));
      if (snap.docs.length < EXPORT_PAGE_SIZE) return { value: docs, ok: true };
      if (n >= EXPORT_MAX_PAGES) {
        logger.warn("user_data_export_list_truncated", { section: label, pages: n });
        return { value: docs, ok: true, truncated: true };
      }
      page = exportNextPage(first, snap.docs[snap.docs.length - 1]);
    }
  } catch (err) {
    const code = codeOf(err);
    logger.warn("user_data_export_collection_failed", { section: label, code });
    return { value: docs, ok: false, code };
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
