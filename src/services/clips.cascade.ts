/**
 * Account-deletion cascade for clips.
 */

import { deleteDoc, doc, getDocs, query, where } from "firebase/firestore";
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
 * Best-effort, mirroring {@link deleteUserClips}: a failed query is logged and
 * swallowed (so the larger deletion flow continues), and per-doc delete
 * failures are tolerated rather than thrown.
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

  const results = await Promise.allSettled(snap.docs.map((d) => deleteDoc(doc(db, "clipVotes", d.id))));

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    logger.warn("clip_votes_delete_partial", { uid, total: results.length, failed });
  }
}
