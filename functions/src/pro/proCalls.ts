/**
 * Pro calls -> What's That Trick gold labels.
 *
 * proReviews/{clipId_uid}: a verified pro settles a split vote (item in
 * 'pro_queue'). proGold/{clipId}: a verified pro marks a clip's known-correct
 * trick. Rules gate both creates to verified pros (never an admin power).
 * This trigger turns the first call per clip into wttGold/{clipId}, which the
 * nightly reliability job scores voters against, and closes a queued item
 * with the pro's call as its label. Later calls on the same clip are no-ops.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";

export type ProCallKind = "review" | "gold";

export interface ProCallResult {
  applied: boolean;
  reason?: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function applyProCall(
  db: Firestore,
  kind: ProCallKind,
  data: Record<string, unknown> | undefined,
): Promise<ProCallResult> {
  const clipId = str(data?.clipId);
  const uid = str(data?.uid);
  const answer = str(data?.answerTrickId);
  if (!clipId || !uid || !answer) return { applied: false, reason: "malformed" };

  return db.runTransaction(async (tx) => {
    const userSnap = await tx.get(db.collection("users").doc(uid));
    if (userSnap.data()?.isVerifiedPro !== true) return { applied: false, reason: "not_pro" };
    const goldRef = db.collection("wttGold").doc(clipId);
    const itemRef = db.collection("wttItems").doc(clipId);
    const [goldSnap, itemSnap] = [await tx.get(goldRef), await tx.get(itemRef)];
    if (!itemSnap.exists) return { applied: false, reason: "no_item" };
    if (goldSnap.exists) return { applied: false, reason: "already_gold" };
    const options = itemSnap.data()?.options;
    if (!Array.isArray(options) || !options.includes(answer)) return { applied: false, reason: "not_an_option" };

    tx.set(goldRef, {
      answerTrickId: answer,
      source: "pro",
      confirmedBy: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (kind === "review" && itemSnap.data()?.status === "pro_queue") {
      tx.update(itemRef, { status: "retired", top: answer, retiredAt: FieldValue.serverTimestamp() });
    }
    return { applied: true };
  });
}
