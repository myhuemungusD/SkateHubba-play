import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";
import type { DrainDeps, QueuedDoc } from "./drain.js";
import { MAX_PER_RUN, PUSH_DISPATCH_COLLECTION } from "./drain.js";

/** Owner-only canonical token list doc id (mirrors users.ts). */
const PRIVATE_PROFILE_DOC_ID = "profile";

function warn(event: string, fields: Record<string, unknown>): void {
  console.warn(JSON.stringify({ event, ...fields }));
}

/** Wire the drain to firebase-admin. */
export function adminDrainDeps(db: Firestore, messaging: Messaging, nowMs: number): DrainDeps {
  return {
    nowMs,
    warn,
    send: (msg) => messaging.sendEachForMulticast(msg),
    prune: async (recipientUid, dead) => {
      await Promise.all([
        db
          .collection("pushTargets")
          .doc(recipientUid)
          .set({ tokens: FieldValue.arrayRemove(...dead), updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
        db
          .collection("users")
          .doc(recipientUid)
          .collection("private")
          .doc(PRIVATE_PROFILE_DOC_ID)
          .set({ fcmTokens: FieldValue.arrayRemove(...dead) }, { merge: true }),
      ]);
    },
  };
}

interface SnapLike {
  id: string;
  data: () => Record<string, unknown> | undefined;
  ref: { delete: () => Promise<unknown> };
}

export function toQueuedDoc(snap: SnapLike): QueuedDoc & { createdAtMs: number | null } {
  const data = snap.data();
  const createdAt = data?.createdAt as { toMillis?: () => number } | undefined;
  return {
    id: snap.id,
    data,
    delete: () => snap.ref.delete(),
    createdAtMs: typeof createdAt?.toMillis === "function" ? createdAt.toMillis() : null,
  };
}

/** Oldest queued docs for the scheduled retry pass. */
export async function readQueue(db: Firestore): Promise<(QueuedDoc & { createdAtMs: number | null })[]> {
  const snap = await db.collection(PUSH_DISPATCH_COLLECTION).orderBy("createdAt", "asc").limit(MAX_PER_RUN).get();
  return snap.docs.map((d: unknown) => toQueuedDoc(d as SnapLike));
}
