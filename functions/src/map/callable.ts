/** Callable entry for map check-ins. Registered in index.ts as `mapCheckin`. */
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/logger";
import { diceAccessAllowed } from "../dice/access.js";
import type { DiceDb } from "../dice/store.js";
import { CheckinInputError, parseCheckinRequest, performCheckin, type CheckinResult } from "./checkin.js";

export interface MapCallDeps {
  enabled: boolean;
  testers: string;
  xpEnabled: boolean;
  xpTesters: string;
  nowMs: number;
  db: DiceDb;
}

/**
 * Auth, the MAP_CHECKINS_ENABLED / MAP_TESTER_UIDS switch, input parsing, then
 * the check-in decision. App Check is logged, not enforced, matching the other
 * callables until docs/APPCHECK_ROLLOUT.md flips enforcement.
 */
export async function handleCheckinCall(request: CallableRequest, deps: MapCallDeps): Promise<CheckinResult> {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "unauthenticated");
  logger.info("map_checkin_appcheck", { present: request.app !== undefined });
  if (!diceAccessAllowed(uid, deps.enabled, deps.testers)) {
    throw new HttpsError("failed-precondition", "map_checkins_disabled");
  }
  let req;
  try {
    req = parseCheckinRequest(request.data);
  } catch (err) {
    throw new HttpsError("invalid-argument", err instanceof CheckinInputError ? err.message : "bad_request");
  }
  try {
    const out = await performCheckin(
      deps.db,
      { uid, nowMs: deps.nowMs, xpOn: diceAccessAllowed(uid, deps.xpEnabled, deps.xpTesters) },
      req,
    );
    logger.info("map_checkin", { code: out.code, xp: out.xp });
    return out;
  } catch (err) {
    logger.error("map_checkin_failed", { message: err instanceof Error ? err.message : "unknown" });
    throw new HttpsError("internal", "checkin_failed");
  }
}
