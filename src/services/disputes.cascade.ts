/**
 * Account-deletion cascade for community disputes.
 *
 * Mirrors `clips.cascade.ts`: best-effort, `Promise.allSettled`, partial
 * failures logged rather than thrown, so a stuck delete never blocks the
 * larger `deleteUserData` flow.
 */

import { deleteDoc, doc, getDocs, query, runTransaction, where } from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import { coerceVoteCount, disputesRef, disputeVotesRef } from "./disputes.mappers";

/**
 * Delete every dispute RAISED by `uid`. Invoked from `deleteUserData` when a
 * user removes their account — closes the GDPR/CCPA "right to erasure" loop
 * so a dispute doesn't outlive the account that raised it.
 *
 * The setter is the author (they are the only one who can create the doc),
 * so ownership is `setterUid`. Disputes raised against this user by someone
 * else are NOT deleted here: the owner-only delete rule means only their
 * author can remove them, which requires the Admin SDK.
 *
 * Best-effort: logs and swallows a failed query and per-doc delete failures.
 */
export async function deleteUserDisputes(uid: string): Promise<void> {
  const db = requireDb();
  let snap;
  try {
    snap = await withRetry(() => getDocs(query(disputesRef(), where("setterUid", "==", uid))));
  } catch (err) {
    logger.warn("disputes_delete_query_failed", { uid, error: parseFirebaseError(err) });
    return;
  }

  const results = await Promise.allSettled(snap.docs.map((d) => deleteDoc(doc(db, "disputes", d.id))));

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    logger.warn("disputes_delete_partial", { uid, total: results.length, failed });
  }
}

/**
 * Delete every `disputeVotes` doc CAST by `uid` (verdicts they ruled on other
 * people's disputes). Without this the user's verdicts outlive their account
 * — the same right-to-erasure gap `deleteUserClipVotes` closes for upvotes.
 *
 * Vote docs are keyed `{uid}_{disputeId}` and carry a `uid` field equal to
 * the voter; the owner-only delete rule means this must run AS `uid`, i.e.
 * before the auth/profile teardown.
 *
 * Each vote is removed in a `runTransaction` that also decrements the tally
 * field its verdict incremented — mirroring the create side in
 * `castDisputeVerdict`, where the vote-doc create and the +1 are paired
 * atomically. Without the decrement the denormalized tally stays permanently
 * inflated after a voter deletes their account.
 *
 * Defensive guards inside the transaction, matching `deleteUserClipVotes`:
 *   - a vote with no usable disputeId/verdict is still deleted, we just skip
 *     the (untargetable) tally adjustment;
 *   - if the dispute is already gone, skip the decrement and drop the orphan;
 *   - never write a negative count — a 0 (or drifted) aggregate has nothing
 *     to subtract, and writing `0` would be an empty diff the rule rejects,
 *     so the decrement is skipped entirely in that case.
 */
export async function deleteUserDisputeVotes(uid: string): Promise<void> {
  const db = requireDb();
  let snap;
  try {
    snap = await withRetry(() => getDocs(query(disputeVotesRef(), where("uid", "==", uid))));
  } catch (err) {
    logger.warn("dispute_votes_delete_query_failed", { uid, error: parseFirebaseError(err) });
    return;
  }

  const results = await Promise.allSettled(
    snap.docs.map((d) => {
      const data = d.data() as { disputeId?: unknown; verdict?: unknown };
      const disputeId = typeof data.disputeId === "string" && data.disputeId.length > 0 ? data.disputeId : null;
      const verdict = data.verdict === "land" || data.verdict === "bail" ? data.verdict : null;
      const voteRef = doc(db, "disputeVotes", d.id);

      return runTransaction(db, async (tx) => {
        if (disputeId === null || verdict === null) {
          tx.delete(voteRef);
          return;
        }
        const disputeRef = doc(db, "disputes", disputeId);
        const disputeSnap = await tx.get(disputeRef);
        tx.delete(voteRef);
        // Nothing left to keep consistent once the dispute is gone, and the
        // rule's -1 branch requires the dispute doc to exist.
        if (!disputeSnap.exists()) return;
        const field = verdict === "land" ? "landVotes" : "bailVotes";
        const current = coerceVoteCount((disputeSnap.data() as Record<string, unknown>)[field]);
        if (current <= 0) return;
        tx.update(disputeRef, { [field]: current - 1 });
      });
    }),
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    logger.warn("dispute_votes_delete_partial", { uid, total: results.length, failed });
  }
}
