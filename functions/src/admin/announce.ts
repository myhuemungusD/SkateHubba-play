/**
 * Admin announcements -> push fan-out.
 *
 * announcements/{id} is admin-claim create only (firestore.rules). When an
 * announcement asks for push, this trigger queues one push_dispatch doc per
 * recipient (the existing courier delivers and prunes dead tokens per uid).
 * Audience: everyone with a registered device, the feature testers, or
 * verified pros. Capped per announcement; marked so a retry never re-sends.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { testerEligibleTokens } from "../push/platforms.js";

export const MAX_RECIPIENTS = 2000;
export type Audience = "all" | "testers" | "pros";

export interface FanOutResult {
  queued: number;
  reason?: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const tokensOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((t): t is string => typeof t === "string" && t.length > 0) : [];

async function audienceUids(db: Firestore, audience: Audience): Promise<string[] | null> {
  if (audience === "all") return null;
  if (audience === "testers") {
    const snap = await db.collection("config").doc("featureTesters").get();
    const uids = snap.data()?.uids;
    return Array.isArray(uids) ? uids.filter((u): u is string => typeof u === "string") : [];
  }
  const pros = await db.collection("users").where("isVerifiedPro", "==", true).limit(MAX_RECIPIENTS).get();
  return pros.docs.map((d) => d.id);
}

export async function fanOutAnnouncement(
  db: Firestore,
  id: string,
  data: Record<string, unknown> | undefined,
): Promise<FanOutResult> {
  if (data?.push !== true) return { queued: 0, reason: "no_push" };
  const title = str(data.title).slice(0, 80);
  const body = str(data.body).slice(0, 240);
  const audience = str(data.audience) as Audience;
  if (!title || !body || !["all", "testers", "pros"].includes(audience)) return { queued: 0, reason: "malformed" };

  const ref = db.collection("announcements").doc(id);
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.data()?.pushStatus) return false;
    tx.update(ref, { pushStatus: "sending" });
    return true;
  });
  if (!claimed) return { queued: 0, reason: "already_sent" };

  const uids = await audienceUids(db, audience);
  const targets: { uid: string; tokens: string[] }[] = [];
  if (uids === null) {
    const all = await db.collection("pushTargets").limit(MAX_RECIPIENTS).get();
    for (const d of all.docs) targets.push({ uid: d.id, tokens: tokensOf(d.data()?.tokens) });
  } else {
    for (const uid of uids.slice(0, MAX_RECIPIENTS)) {
      const snap = await db.collection("pushTargets").doc(uid).get();
      const mirror = snap.data();
      const tokens = tokensOf(mirror?.tokens);
      // Testers on iPhone can't see tester features, so skip ios and untagged tokens.
      targets.push({ uid, tokens: audience === "testers" ? testerEligibleTokens(mirror, tokens) : tokens });
    }
  }

  let queued = 0;
  let batch = db.batch();
  let inBatch = 0;
  for (const t of targets) {
    if (t.tokens.length === 0) continue;
    batch.set(db.collection("push_dispatch").doc(), {
      tokens: t.tokens,
      notification: { title, body },
      data: { type: "announcement", announcementId: id, click_action: "/" },
      senderUid: str(data.createdBy),
      recipientUid: t.uid,
      type: "announcement",
      createdAt: FieldValue.serverTimestamp(),
    });
    queued++;
    if (++inBatch === 400) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();
  await ref.update({ pushStatus: "sent", pushCount: queued, pushedAt: FieldValue.serverTimestamp() });
  return { queued };
}
