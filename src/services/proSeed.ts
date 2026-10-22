/**
 * Admin seeding of Verified Pro through the `proSeed` callable.
 *
 * There is no client write path to `isVerifiedPro` any more, admins
 * included: the callable checks the admin claim and App Check, requires a
 * reason plus evidence (company + https link) and writes an append-only
 * `proAudit` row in the same transaction as the badge (security audit
 * 2026-10-21). Revoke stays on `proBlessing` {action:'revoke'}.
 */
import { addBreadcrumb, captureException } from "../lib/sentry";
import * as firebase from "../firebase";
import { logger } from "./logger";
import { recordAdminAction } from "./admin.audit";

export const SEED_REASON_MIN = 10;
export const SEED_REASON_MAX = 280;
export const SEED_COMPANY_MAX = 80;

export interface ProSeedEvidence {
  company: string;
  url: string;
}

const MESSAGES: Record<string, string> = {
  not_admin: "Only admins can seed pros.",
  app_check_required: "App Check failed. Reload and try again.",
  bad_reason: `Say why in ${SEED_REASON_MIN}–${SEED_REASON_MAX} characters.`,
  bad_evidence_company: "Name the company (board, shoe or video credit).",
  bad_evidence_url: "Evidence must be an https link.",
  self_seed: "You can't seed yourself.",
  already_pro: "They're already pro.",
  target_banned: "That skater is banned.",
  not_found: "That skater's profile no longer exists.",
};

export function proSeedErrorMessage(err: unknown): string {
  const key = err instanceof Error ? err.message : "";
  return MESSAGES[key] ?? "Seeding failed. Try again.";
}

/** True when the inputs pass the same checks the callable runs, so the UI can disable Grant. */
export function seedInputReady(reason: string, evidence: ProSeedEvidence): boolean {
  const r = reason.replace(/\s+/g, " ").trim();
  const c = evidence.company.trim();
  let urlOk = false;
  try {
    const u = new URL(evidence.url.trim());
    urlOk = u.protocol === "https:" && u.hostname.includes(".");
  } catch {
    urlOk = false;
  }
  return (
    r.length >= SEED_REASON_MIN && r.length <= SEED_REASON_MAX && c.length >= 2 && c.length <= SEED_COMPANY_MAX && urlOk
  );
}

/** Seed Verified Pro on `targetUid`. Resolves with the proAudit row id. */
export async function seedVerifiedPro(targetUid: string, reason: string, evidence: ProSeedEvidence): Promise<string> {
  addBreadcrumb({ category: "pro_seed", message: "seed" });
  try {
    await firebase.ensureAppCheck();
    const { getFunctions, httpsCallable, connectFunctionsEmulator } = await import("firebase/functions");
    const app = firebase.default;
    if (!app) throw new Error("Firebase not initialized");
    const fns = getFunctions(app, "us-central1");
    if (firebase.isEmulatorMode) connectFunctionsEmulator(fns, "127.0.0.1", 5001);
    const res = await httpsCallable(fns, "proSeed")({ targetUid, reason, evidence });
    const data = res.data as { auditId?: unknown };
    if (typeof data?.auditId !== "string") throw new Error("bad response");
    recordAdminAction("grant_pro", targetUid);
    return data.auditId;
  } catch (err) {
    captureException(err);
    logger.warn("pro_seed_call_failed", {});
    throw err;
  }
}
