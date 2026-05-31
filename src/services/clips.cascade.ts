/**
 * Account-deletion cascade for clips.
 */

import { deleteDoc, doc, getDocs, query, runTransaction, where } from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import { clipsRef, clipVotesRef } from "./clips.mappers";

/**
 * Delete every clip owned by `uid`. Invoked from `deleteUserData` when a
 * user removes their account — closes the GDPR/CCPA "right to erasure"
 * loop so clips don't outlive the account that produced them.
 *
 * Best-effort: logs and swallows per-doc delete failures so a partial
 * cascade never blocks the larger account-deletion flow. The owner-only
 * delete rule in firestore.rules means this caller must be authenticated
 * AS `uid` — servicing another user's deletion requires Admin SDK.
 */
export async function deleteUserClips(uid: string): Promise<void> {
  const db = requireDb();
  let snap;
  try {
    snap = await withRetry(() => getDocs(query(clipsRef(), where("playerUid", "==", uid))));
  } catch (err) {
    logger.warn("clips_delete_query_failed", { uid, error: parseFirebaseError(err) });
    return;
  }

  const results = await Promise.allSettled(snap.docs.map((d) => deleteDoc(doc(db, "clips", d.id))));

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    logger.warn("clips_delete_partial", { uid, total: results.length, failed });
  }
}

/**
 * Delete every `clipVotes` doc CAST by `uid` (votes they placed on other
 * users' clips). Invoked from `deleteUserData` alongside {@link deleteUserClips}
 * so account deletion erases both the clips a user authored AND the votes they
 * cast — without this, the user's votes outlive their account (GDPR/CCPA
 * right-to-erasure gap).
 *
 * Vote docs are keyed `{uid}_{clipId}` and carry a `uid` field equal to the
 * voter; the owner-only delete rule (`request.auth.uid == resource.data.uid`)
 * means this must run AS `uid`, i.e. before the auth/profile teardown.
 *
 * Each vote is removed in a `runTransaction` that also decrements the parent
 * `clips/{clipId}.upvoteCount` aggregate — mirroring the create side in
 * `upvoteClip`, where the vote-doc create and the +1 are paired atomically.
 * Without the decrement the denormalized count (read by the feed's `top`
 * sort and the ranking) stays permanently inflated after a voter deletes
 * their account. The firestore `clips` update rule (firestore.rules:1964)
 * permits this non-owner decrement-by-1 precisely because it is paired with
 * the matching vote-doc delete in the same atomic write.
 *
 * Defensive guards inside the transaction:
 *   - if the clip doc is gone (owner already deleted it / its own cascade
 *     ran first), skip the decrement and just delete the orphan vote;
 *   - never write a negative count — `max(current - 1, 0)` clamps at 0 so a
 *     drifted/corrupted aggregate can't go below the rule's `>= 0` floor.
 *
 * Best-effort, mirroring {@link deleteUserClips}: a failed query is logged and
 * swallowed (so the larger deletion flow continues), and per-vote transaction
 * failures are tolerated rather than thrown (Promise.allSettled).
 */
export async function deleteUserClipVotes(uid: string): Promise<void> {
  const db = requireDb();
  let snap;
  try {
    snap = await withRetry(() => getDocs(query(clipVotesRef(), where("uid", "==", uid))));
  } catch (err) {
    logger.warn("clip_votes_delete_query_failed", { uid, error: parseFirebaseError(err) });
    return;
  }

  const results = await Promise.allSettled(
    snap.docs.map((d) => {
      // The vote doc body carries the clipId (written by upvoteClip); prefer
      // it over re-parsing the `{uid}_{clipId}` doc id so a legacy/malformed
      // id format can't point the decrement at the wrong clip. A vote with no
      // usable clipId still gets deleted — we just skip the (untargetable)
      // count adjustment.
      const data = d.data() as { clipId?: unknown };
      const clipId = typeof data.clipId === "string" && data.clipId.length > 0 ? data.clipId : null;
      const voteRef = doc(db, "clipVotes", d.id);

      return runTransaction(db, async (tx) => {
        if (clipId === null) {
          tx.delete(voteRef);
          return;
        }
        const clipRef = doc(db, "clips", clipId);
        const clipSnap = await tx.get(clipRef);
        tx.delete(voteRef);
        // Skip the decrement when the clip is already gone — the rule's -1
        // branch requires the clip doc to exist, and there is nothing left to
        // keep consistent.
        if (!clipSnap.exists()) return;
        const raw = (clipSnap.data() as { upvoteCount?: unknown }).upvoteCount;
        const current = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 0;
        // Floor at 0: a 0 (or drifted) aggregate has nothing to decrement, so
        // skip the update entirely. Writing `0` would mean a no-op diff that
        // the rule's hasOnly(['upvoteCount']) clause rejects (empty affected
        // keys), and `-1` would violate its `>= 0` floor — either rejection
        // would fail the whole tx and orphan the vote. So decrement only when
        // there is a positive count to subtract from.
        if (current <= 0) return;
        tx.update(clipRef, { upvoteCount: current - 1 });
      });
    }),
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    logger.warn("clip_votes_delete_partial", { uid, total: results.length, failed });
  }
}
