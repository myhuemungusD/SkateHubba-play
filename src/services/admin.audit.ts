import { addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp } from "firebase/firestore";
import { requireAuth, requireDb } from "../firebase";
import { isAdminOpsEnabled } from "../lib/featureFlags";

/**
 * Admin audit log (behind VITE_FEATURE_ADMIN_OPS). `adminAudit/{id}` is
 * append-only and admin-claim only in firestore.rules: who did what, to
 * whom, and when. Recording is best-effort and never blocks or fails the
 * action it describes.
 */

export const AUDIT_LIST_LIMIT = 100;

export type AdminAction =
  | "ban"
  | "unban"
  | "grant_pro"
  | "revoke_pro"
  | "award_badge"
  | "revoke_badge"
  | "award_item"
  | "remove_item"
  | "hide_dispute"
  | "rule_dispute"
  | "resolve_report"
  | "announce"
  | "end_announcement";

export interface AuditEntry {
  id: string;
  adminUid: string;
  action: string;
  targetId: string;
  detail: string;
  atMs: number | null;
}

/** Fire-and-forget audit write. Swallows every failure, including a missing auth/db. */
export function recordAdminAction(action: AdminAction, targetId: string, detail = ""): void {
  try {
    if (!isAdminOpsEnabled()) return;
    const adminUid = requireAuth().currentUser?.uid;
    if (!adminUid) return;
    addDoc(collection(requireDb(), "adminAudit"), {
      adminUid,
      action,
      targetId: targetId.slice(0, 128),
      detail: detail.slice(0, 300),
      at: serverTimestamp(),
    }).catch(() => undefined);
  } catch {
    // best-effort
  }
}

/** Newest admin actions first. */
export async function listAdminAudit(): Promise<AuditEntry[]> {
  const snap = await getDocs(
    query(collection(requireDb(), "adminAudit"), orderBy("at", "desc"), limit(AUDIT_LIST_LIMIT)),
  );
  return snap.docs.map((d) => {
    const x = d.data();
    const at = x.at as { toMillis?: () => number } | undefined;
    return {
      id: d.id,
      adminUid: typeof x.adminUid === "string" ? x.adminUid : "",
      action: typeof x.action === "string" ? x.action : "",
      targetId: typeof x.targetId === "string" ? x.targetId : "",
      detail: typeof x.detail === "string" ? x.detail : "",
      atMs: typeof at?.toMillis === "function" ? at.toMillis() : null,
    };
  });
}
