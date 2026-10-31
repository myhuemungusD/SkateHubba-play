import { limit, where, type QueryConstraint } from "firebase/firestore";

/** How many of the pro's posts are scanned for spot tags. */
const PRO_CLIP_SCAN_LIMIT = 60;

/**
 * The Pro Spots query on `clips`: one pro's active user posts. Its own module
 * so the rules test (rules-tests/clips.rules.test.ts) runs this exact query
 * instead of a copy, without loading the app's Firebase setup.
 *
 * - `source` is filtered in the query, before the limit, so game clips can't
 *   crowd posts out of the scan.
 * - `moderationStatus` makes the query provable for a visitor: the clips read
 *   rule lets a non-owner read active clips only, so without it every
 *   visitor's query is denied.
 *
 * Index: equality-only with no orderBy, so Firestore merges the automatic
 * single-field indexes and no composite index is needed. The 60 scanned are
 * in document-id order, not newest. Adding an `orderBy` (e.g. createdAt desc
 * for "newest 60") or a range filter needs a composite index
 * (playerUid, source, moderationStatus, createdAt desc) in
 * firestore.indexes.json AND an approved index deploy before the code ships;
 * otherwise the query fails in prod with failed-precondition, which the
 * caller logs as `pro_spots_failed` and shows as no spots.
 */
export function proSpotsConstraints(uid: string): QueryConstraint[] {
  return [
    where("playerUid", "==", uid),
    where("source", "==", "user"),
    where("moderationStatus", "==", "active"),
    limit(PRO_CLIP_SCAN_LIMIT),
  ];
}
