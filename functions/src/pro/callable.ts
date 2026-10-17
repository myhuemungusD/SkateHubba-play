/** Callable entry for pro blessings. Registered in index.ts as `proBlessing`. */
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/logger";
import { diceAccessAllowed } from "../dice/access.js";
import type { DiceDb } from "../dice/store.js";
import { BlessingError, blessSkater, respondToBlessing, revokePro, type BlessingResult } from "./handlers.js";
import type { BlessingConfig } from "./rules.js";

export interface BlessingCallDeps {
  enabled: boolean;
  testers: string;
  nowMs: number;
  db: DiceDb;
  config: BlessingConfig;
}

const DENIED = new Set(["not_a_pro", "not_yours", "blesser_not_pro", "not_admin"]);
const INVALID = new Set(["self_blessing", "bad_reason", "bad_request"]);

function toHttps(err: BlessingError): HttpsError {
  if (err.code === "not_found") return new HttpsError("not-found", err.code);
  if (DENIED.has(err.code)) return new HttpsError("permission-denied", err.code);
  if (INVALID.has(err.code)) return new HttpsError("invalid-argument", err.code);
  if (err.code === "limit_reached") return new HttpsError("resource-exhausted", err.code);
  return new HttpsError("failed-precondition", err.code);
}

function id(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || value.includes("/")) {
    throw new HttpsError("invalid-argument", "bad_request");
  }
  return value;
}

export async function handleBlessingCall(request: CallableRequest, deps: BlessingCallDeps): Promise<BlessingResult> {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "unauthenticated");
  const isAdmin = request.auth?.token.admin === true;
  // Admins can always revoke; everything else sits behind the kill switch.
  const body = (request.data && typeof request.data === "object" ? request.data : {}) as Record<string, unknown>;
  if (body.action !== "revoke" && !diceAccessAllowed(uid, deps.enabled, deps.testers)) {
    throw new HttpsError("failed-precondition", "blessing_disabled");
  }
  const actor = { uid, emailVerified: request.auth?.token.email_verified === true, nowMs: deps.nowMs };
  try {
    switch (body.action) {
      case "bless":
        return await blessSkater(deps.db, actor, id(body.targetUid), body.reason, deps.config);
      case "accept":
      case "decline":
        return await respondToBlessing(deps.db, actor, id(body.blessingId), body.action === "accept", deps.config);
      case "revoke":
        if (!isAdmin) throw new HttpsError("permission-denied", "not_admin");
        return await revokePro(deps.db, actor, id(body.targetUid), body.reason);
      default:
        throw new HttpsError("invalid-argument", "bad_request");
    }
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    if (err instanceof BlessingError) throw toHttps(err);
    logger.error("pro_blessing_failed", { message: err instanceof Error ? err.message : "unknown" });
    throw new HttpsError("internal", "blessing_failed");
  }
}
