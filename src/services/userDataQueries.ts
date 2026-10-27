import {
  collection,
  limit,
  query,
  startAfter,
  where,
  type DocumentSnapshot,
  type Firestore,
  type Query,
} from "firebase/firestore";

/**
 * Docs per page for each collection read. Reads page through with
 * `startAfter` until a page comes back short. This is the only place the
 * page size is set: the queries below use it and readCollection's "short
 * page means done" check uses it, so the two can't disagree.
 */
export const EXPORT_PAGE_SIZE = 500;

/**
 * Safety ceiling on pages per query (10 × 500 = 5,000 docs per list). A list
 * that still has a full page at the ceiling is reported as incomplete in the
 * export instead of being cut off silently.
 */
export const EXPORT_MAX_PAGES = 10;

/**
 * The Firestore queries behind "Download my data", one per surface. Each one
 * returns the first page; {@link exportNextPage} builds the following pages.
 *
 * Kept free of app wiring (no `requireDb`, no logger) so the rules tests can
 * run these exact queries against the emulator as the signed-in owner.
 *
 * Two constraints every query here must keep:
 *
 *   1. Equality filters only, no `orderBy`. Firestore serves equality-only
 *      queries from its automatic single-field indexes. An equality filter
 *      plus `orderBy` on a different field needs a composite index, and the
 *      ones this export used to rely on (e.g. games `player1Uid` +
 *      `createdAt desc`) were never in firestore.indexes.json, so those reads
 *      failed and the export quietly left out the user's games, clips, spots
 *      and notifications. Ordering is done in memory instead
 *      (see `sortNewestFirst` in userData.ts). Paging with `startAfter` uses
 *      the implicit document-id order, which needs no extra index either.
 *
 *   2. Rules are not filters. Each query has to carry the constraint its read
 *      rule checks, or the whole query is refused. Spot reads require
 *      `isActive == true` (firestore.rules, spots `allow read`), so the spots
 *      query says so. Users can't make a spot inactive: they can only
 *      hard-delete their own spots, and a deleted spot no longer exists. The
 *      filter therefore only leaves out spots an admin or moderator
 *      deactivated. Those still reach the user through the privacy contact
 *      named in the export notice.
 */
export function exportCollectionQueries(db: Firestore, uid: string) {
  const page = limit(EXPORT_PAGE_SIZE);
  return {
    gamesAsPlayer1: query(collection(db, "games"), where("player1Uid", "==", uid), page),
    gamesAsPlayer2: query(collection(db, "games"), where("player2Uid", "==", uid), page),
    gamesAsJudge: query(collection(db, "games"), where("judgeId", "==", uid), page),
    clips: query(collection(db, "clips"), where("playerUid", "==", uid), page),
    clipVotes: query(collection(db, "clipVotes"), where("uid", "==", uid), page),
    spots: query(collection(db, "spots"), where("createdBy", "==", uid), where("isActive", "==", true), page),
    notifications: query(collection(db, "notifications"), where("recipientUid", "==", uid), page),
    nudgesSent: query(collection(db, "nudges"), where("senderUid", "==", uid), page),
    nudgesReceived: query(collection(db, "nudges"), where("recipientUid", "==", uid), page),
    blockedUsers: query(collection(db, "users", uid, "blocked_users"), page),
    reports: query(collection(db, "reports"), where("reporterUid", "==", uid), page),
    moderationStatements: query(collection(db, "moderationStatements"), where("subjectUid", "==", uid), page),
    appeals: query(collection(db, "appeals"), where("appellantUid", "==", uid), page),
  } satisfies Record<string, Query>;
}

export type ExportQueryName = keyof ReturnType<typeof exportCollectionQueries>;

/** The page after `last`, with the same filters and page size as `first`. */
export function exportNextPage(first: Query, last: DocumentSnapshot): Query {
  return query(first, startAfter(last));
}
