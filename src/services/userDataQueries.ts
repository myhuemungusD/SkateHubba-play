import { collection, limit, query, where, type Firestore, type Query } from "firebase/firestore";

/**
 * Per-surface cap for collection reads. High enough to cover any realistic
 * user while bounding read cost and memory. If a user truly has more than
 * this many docs in a surface, the export bundle's `capped` flag is `true`.
 */
export const EXPORT_QUERY_LIMIT = 500;

/**
 * The Firestore queries behind "Download my data", one per surface.
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
 *      (see `sortNewestFirst` in userData.ts).
 *
 *   2. Rules are not filters. Each query has to carry the constraint its read
 *      rule checks, or the whole query is refused. Spots are only readable
 *      while `isActive == true`, so the spots query says so; a spot the user
 *      deleted (made inactive) can't be read back by its creator and is not
 *      part of the export.
 */
export function exportCollectionQueries(db: Firestore, uid: string) {
  const cap = limit(EXPORT_QUERY_LIMIT);
  return {
    gamesAsPlayer1: query(collection(db, "games"), where("player1Uid", "==", uid), cap),
    gamesAsPlayer2: query(collection(db, "games"), where("player2Uid", "==", uid), cap),
    gamesAsJudge: query(collection(db, "games"), where("judgeId", "==", uid), cap),
    clips: query(collection(db, "clips"), where("playerUid", "==", uid), cap),
    clipVotes: query(collection(db, "clipVotes"), where("uid", "==", uid), cap),
    spots: query(collection(db, "spots"), where("createdBy", "==", uid), where("isActive", "==", true), cap),
    notifications: query(collection(db, "notifications"), where("recipientUid", "==", uid), cap),
    nudgesSent: query(collection(db, "nudges"), where("senderUid", "==", uid), cap),
    nudgesReceived: query(collection(db, "nudges"), where("recipientUid", "==", uid), cap),
    blockedUsers: query(collection(db, "users", uid, "blocked_users"), cap),
    reports: query(collection(db, "reports"), where("reporterUid", "==", uid), cap),
    moderationStatements: query(collection(db, "moderationStatements"), where("subjectUid", "==", uid), cap),
    appeals: query(collection(db, "appeals"), where("appellantUid", "==", uid), cap),
  } satisfies Record<string, Query>;
}

export type ExportQueryName = keyof ReturnType<typeof exportCollectionQueries>;
