/**
 * Callable entry for Roll Dice. Registration lives in index.ts so the
 * stats-trigger tests can keep mocking the Firestore trigger in isolation.
 */
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/logger";
import { diceAccessAllowed } from "./access.js";
import {
  claimDiceTimeout,
  createDiceGame,
  declineDice,
  DiceActionError,
  quitDice,
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

function httpsFromAction(err: DiceActionError): HttpsError {
  if (err.code === "not_a_player") return new HttpsError("permission-denied", err.code);
  if (err.code === "not_found") return new HttpsError("not-found", err.code);
  if (err.code === "self_challenge" || err.code === "bad_dice" || err.code === "bad_doc") {
    return new HttpsError("invalid-argument", err.code);
  }
  return new HttpsError("failed-precondition", err.code);
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
  const body = raw as { action?: unknown; opponentUid?: unknown; gameId?: unknown };
  const actor = {
    uid,
    emailVerified: request.auth?.token.email_verified === true,
    nowMs: deps.nowMs,
  };

  try {
    switch (body.action) {
      case "create":
        if (typeof body.opponentUid !== "string") throw new HttpsError("invalid-argument", "bad_request");
        return await createDiceGame(deps.db, actor, body.opponentUid);
      case "roll":
      case "quit":
      case "decline":
      case "claimTimeout": {
        if (typeof body.gameId !== "string" || body.gameId.length === 0) {
          throw new HttpsError("invalid-argument", "bad_request");
        }
        if (body.action === "roll") return await rollDice(deps.db, actor, body.gameId);
        if (body.action === "quit") return await quitDice(deps.db, actor, body.gameId);
        if (body.action === "decline") return await declineDice(deps.db, actor, body.gameId);
        return await claimDiceTimeout(deps.db, actor, body.gameId);
      }
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
