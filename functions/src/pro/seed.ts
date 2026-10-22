/**
 * Admin seeding of Verified Pro (`proSeed` callable).
 *
 * Seeding used to be a direct client write by any admin (a Firestore rules
 * branch on users/{uid}) or the `scripts/grant-pro.ts` CLI, with no reason
 * and no evidence, so nothing recorded *why* anyone was pro and a stolen
 * admin token could mint pros silently (security audit 2026-10-21;
 * docs/team spec pro-filmer-stats G2).
 *
 * Now the only seeding path is this callable (admin custom claim + App
 * Check). It requires a reason and evidence (company + https link), and in
 * one transaction sets the badge and writes an append-only `proAudit` row.
 * Rules deny every client write to `proAudit` and let only admins read it.
 * The CLI writes the same row (see `scripts/grant-pro.ts`).
 */
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/logger";
import { Timestamp } from "firebase-admin/firestore";
import type { DiceDb } from "../dice/store.js";
import { parseSeedInput, SeedInputError, type SeedInput } from "./seedInput.js";

export const PRO_AUDIT_COLLECTION = "proAudit";

export interface ProSeedDeps {
  db: DiceDb;
  nowMs: number;
}

export interface ProSeedResult {
  auditId: string;
  status: "seeded";
}

class SeedError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SeedError";
  }
}

export async function seedPro(
  db: DiceDb,
  actorUid: string,
  input: SeedInput,
  nowMs: number,
  source: "callable" | "cli" = "callable",
): Promise<ProSeedResult> {
  if (input.targetUid === actorUid) throw new SeedError("self_seed");
  const auditId = db.newId(PRO_AUDIT_COLLECTION);
  return db.runTransaction(async (tx) => {
    const target = (await tx.get(`users/${input.targetUid}`)).data;
    if (!target) throw new SeedError("not_found");
    if (target.isVerifiedPro === true) throw new SeedError("already_pro");
    if (target.banned === true) throw new SeedError("target_banned");
    const now = Timestamp.fromMillis(nowMs);
    tx.update(`users/${input.targetUid}`, { isVerifiedPro: true, verifiedBy: actorUid, verifiedAt: now });
    tx.set(`${PRO_AUDIT_COLLECTION}/${auditId}`, {
      action: "seed",
      actorUid,
      targetUid: input.targetUid,
      targetUsername: typeof target.username === "string" ? target.username : "",
      reason: input.reason,
      evidenceCompany: input.evidenceCompany,
      evidenceUrl: input.evidenceUrl,
      source,
      createdAt: now,
    });
    return { auditId, status: "seeded" as const };
  });
}

const CODES: Record<string, HttpsError["code"]> = {
  self_seed: "permission-denied",
  not_found: "not-found",
  already_pro: "failed-precondition",
  target_banned: "failed-precondition",
};

export async function handleProSeedCall(request: CallableRequest, deps: ProSeedDeps): Promise<ProSeedResult> {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "unauthenticated");
  // The custom claim is the only admin signal; isVerifiedPro never implies admin.
  if (request.auth?.token.admin !== true) throw new HttpsError("permission-denied", "not_admin");
  // enforceAppCheck rejects a missing token before this runs; this is a second
  // line in case the registration flag is ever flipped off.
  if (!request.app) throw new HttpsError("failed-precondition", "app_check_required");
  try {
    const input = parseSeedInput(request.data);
    const result = await seedPro(deps.db, uid, input, deps.nowMs);
    logger.info("pro_seeded", { actorUid: uid, targetUid: input.targetUid, auditId: result.auditId });
    return result;
  } catch (err) {
    if (err instanceof SeedInputError) throw new HttpsError("invalid-argument", err.code);
    if (err instanceof SeedError) throw new HttpsError(CODES[err.code] ?? "failed-precondition", err.code);
    logger.error("pro_seed_failed", { message: err instanceof Error ? err.message : "unknown" });
    throw new HttpsError("internal", "seed_failed");
  }
}
