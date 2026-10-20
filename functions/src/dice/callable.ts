/**
 * Callable entry for Roll Dice. Registration lives in index.ts so the
 * stats-trigger tests can keep mocking the Firestore trigger in isolation.
 */
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/logger";
import { diceAccessAllowed } from "./access.js";
import {
  acceptDice,
  bankDice,
  claimDiceTimeout,
  createDiceGame,
  declineDice,
  DiceActionError,
  nudgeDice,
  quitDice,
  rematchDice,
  rollDice,
  type DiceActionResult,
} from "./handlers.js";
import type { DiceDb } from "./store.js";

export interface DiceCallDeps {
  enabled: boolean;
  testers: string;
  nowMs: number;
  db: DiceDb;
}

/** The message is the dice code; `details` repeats it and adds `retryAfterMs` on cooldowns. */
function httpsFromAction(err: DiceActionError): HttpsError {
  const details = { code: err.code, ...err.details };
  if (err.code === "not_a_player") return new HttpsError("permission-denied", err.code, details);
  if (err.code === "not_found") return new HttpsError("not-found", err.code, details);
  if (["self_challenge", "bad_dice", "bad_doc", "bad_mode", "bad_keep", "wrong_mode"].includes(err.code)) {
    return new HttpsError("invalid-argument", err.code, details);
  }
  return new HttpsError("failed-precondition", err.code, details);
}

/** 10,000 keep choice: up to six distinct die indexes. Anything else is a bad request. */
function parseKeep(raw: unknown): number[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 6 || raw.some((idx) => !Number.isInteger(idx))) {
    throw new HttpsError("invalid-argument", "bad_request");
  }
  return raw as number[];
}

/**
 * Auth, kill switch, and action dispatch. App Check is observed and not
 * enforced (`enforceAppCheck: false` on the registration) so a missing token
 * is logged rather than rejected.
 */
export async function handleDiceCall(request: CallableRequest, deps: DiceCallDeps): Promise<DiceActionResult> {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "unauthenticated");
  logger.info("dice_appcheck", { present: request.app !== undefined });
  if (!diceAccessAllowed(uid, deps.enabled, deps.testers)) {
    throw new HttpsError("failed-precondition", "dice_disabled");
  }

  const raw = request.data;
  if (!raw || typeof raw !== "object") throw new HttpsError("invalid-argument", "bad_request");
  const body = raw as {
    action?: unknown;
    opponentUid?: unknown;
    gameId?: unknown;
    mode?: unknown;
    target?: unknown;
    keep?: unknown;
  };
  const actor = {
    uid,
    emailVerified: request.auth?.token.email_verified === true,
    nowMs: deps.nowMs,
  };

  try {
    if (body.action === "create") {
      if (typeof body.opponentUid !== "string") throw new HttpsError("invalid-argument", "bad_request");
      return await createDiceGame(deps.db, actor, body.opponentUid, { mode: body.mode, target: body.target });
    }
    if (typeof body.gameId !== "string" || body.gameId.length === 0) {
      throw new HttpsError("invalid-argument", "bad_request");
    }
    const gameId = body.gameId;
    switch (body.action) {
      case "roll":
        return await rollDice(deps.db, actor, gameId, parseKeep(body.keep));
      case "bank":
        return await bankDice(deps.db, actor, gameId, parseKeep(body.keep));
      case "accept":
        return await acceptDice(deps.db, actor, gameId);
      case "rematch":
        return await rematchDice(deps.db, actor, gameId);
      case "nudge":
        return await nudgeDice(deps.db, actor, gameId);
      case "quit":
        return await quitDice(deps.db, actor, gameId);
      case "decline":
        return await declineDice(deps.db, actor, gameId);
      case "claimTimeout":
        return await claimDiceTimeout(deps.db, actor, gameId);
      default:
        throw new HttpsError("invalid-argument", "bad_request");
    }
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    if (err instanceof DiceActionError) throw httpsFromAction(err);
    logger.error("dice_action_failed", { message: err instanceof Error ? err.message : "unknown" });
    throw new HttpsError("internal", "dice_failed");
  }
}
