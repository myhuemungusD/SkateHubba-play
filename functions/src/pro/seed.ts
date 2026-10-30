/**
 * Admin seeding of Verified Pro: the `proSeed` callable.
 *
 * Seeding has been a direct client write by any admin (the users/{uid} admin
 * rules branch) or the `scripts/grant-pro.ts` CLI, with no reason and no
 * evidence, so nothing recorded *why* anyone was pro and a stolen admin token
 * could mint pros silently (security audit 2026-10-21, H5).
 *
 * This callable (admin custom claim + App Check) requires a reason and
 * evidence (company + https link) and, through `seedPro` (seedCore.ts), sets
 * the badge and writes an append-only `proAudit` row in one transaction. The
 * CLI runs the same `seedPro` with `source: "cli"`. Rules let only admins read
 * `proAudit` and deny every client write to it. The old admin client-write
 * rules branch is removed separately in #813b, once this function is live.
 */
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/logger";
import { Timestamp } from "firebase-admin/firestore";
import type { DiceDb } from "../dice/store.js";
import { parseSeedInput, SeedInputError } from "./seedInput.js";
import { SeedError, seedPro, type ProSeedResult } from "./seedCore.js";

export { type ProSeedResult } from "./seedCore.js";

export interface ProSeedDeps {
  db: DiceDb;
  nowMs: number;
  /** Admin custom-claim lookup for the TARGET (pros are never admins). */
  isAdmin: (uid: string) => Promise<boolean>;
}

const CODES: Record<string, HttpsError["code"]> = {
  self_seed: "permission-denied",
  target_is_admin: "permission-denied",
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
    const result = await seedPro(
      { db: deps.db, isAdmin: deps.isAdmin, stamp: Timestamp.fromMillis(deps.nowMs) },
      uid,
      input,
      "callable",
    );
    logger.info("pro_seeded", { actorUid: uid, targetUid: input.targetUid, auditId: result.auditId });
    return result;
  } catch (err) {
    if (err instanceof SeedInputError) throw new HttpsError("invalid-argument", err.code);
    if (err instanceof SeedError) throw new HttpsError(CODES[err.code] ?? "failed-precondition", err.code);
    logger.error("pro_seed_failed", { message: err instanceof Error ? err.message : "unknown" });
    throw new HttpsError("internal", "seed_failed");
  }
}
