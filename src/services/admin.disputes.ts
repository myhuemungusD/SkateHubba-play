import { doc, getDocs, limit, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { requireAuth, requireDb } from "../firebase";
import type { Dispute } from "../types/dispute";
import { disputesRef, toDisputeDoc } from "./disputes.mappers";
import { recordAdminAction } from "./admin.audit";
import { logger } from "./logger";

/**
 * Disputes queue (behind VITE_FEATURE_ADMIN_OPS, admin claim only).
 *
 * Every open dispute, including hidden ones, with its clip and votes. A
 * final ruling stamps `adminRuling` once; the referee cron applies it in
 * place of the crowd tally when the vote window closes (see
 * api/cron/resolve-expired-disputes.ts). Rules allow only admins, only on
 * open disputes, only once.
 */

export const DISPUTE_QUEUE_LIMIT = 50;
export type AdminRuling = "land" | "bail";

export interface QueuedDispute extends Dispute {
  adminRuling: AdminRuling | null;
}

export async function listDisputeQueue(): Promise<QueuedDispute[]> {
  const snap = await getDocs(query(disputesRef(), where("status", "==", "open"), limit(DISPUTE_QUEUE_LIMIT)));
  const out: QueuedDispute[] = [];
  for (const d of snap.docs) {
    try {
      const raw = d.data() as Record<string, unknown>;
      const ruling = raw.adminRuling === "land" || raw.adminRuling === "bail" ? raw.adminRuling : null;
      out.push({ ...toDisputeDoc(d), adminRuling: ruling });
    } catch (err) {
      logger.warn("dispute_queue_malformed", { id: d.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out.sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
}

export async function ruleDispute(disputeId: string, ruling: AdminRuling): Promise<void> {
  const adminUid = requireAuth().currentUser?.uid;
  if (!adminUid) throw new Error("Sign in again to rule.");
  if (ruling !== "land" && ruling !== "bail") throw new Error("Invalid ruling.");
  await updateDoc(doc(requireDb(), "disputes", disputeId), {
    adminRuling: ruling,
    adminRuledBy: adminUid,
    adminRuledAt: serverTimestamp(),
  });
  recordAdminAction("rule_dispute", disputeId, ruling);
}
