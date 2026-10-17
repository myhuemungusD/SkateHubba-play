/**
 * Callable entries for the closet. Registered in index.ts with
 * `enforceAppCheck: true`; the `request.app` check here is a second line in
 * case a registration ever drops the option.
 *
 * Gates: signed in → App Check → kill switch (or admin claim) → handler.
 * Domain errors map to HttpsError codes with the domain code as the message,
 * which the client turns into plain words.
 */
import { HttpsError, type CallableRequest, type FunctionsErrorCode } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/logger";
import { closetAllowed, type ClosetFeature, type ClosetFlags } from "./access.js";
import { createDrop, createItem, retireItem, updateStock } from "./catalog.js";
import { enterDraw } from "./draws.js";
import { claimDrop } from "./drops.js";
import { awardEarn, awardGameEarn, grantEarnedItem } from "./earn.js";
import { equipItem } from "./equip.js";
import { iapRefund, iapVerify, unconfiguredVerifier, type ReceiptVerifier } from "./iap.js";
import { ClosetError, isId, str, type ClosetActor } from "./model.js";
import { buyShopItem } from "./shop.js";
import type { ClosetDb } from "./store.js";
import { confirmTrade, proposeTrade, respondTrade } from "./trading.js";
import { reverseTrade } from "./trading.holds.js";
import { auditWallet } from "./wallet.js";

export interface ClosetDeps {
  flags: ClosetFlags;
  nowMs: number;
  db: ClosetDb;
  verifier?: ReceiptVerifier;
}

type Body = Record<string, unknown>;

const CODE_MAP: Readonly<Record<string, FunctionsErrorCode>> = {
  not_found: "not-found",
  not_party: "permission-denied",
  not_admin: "permission-denied",
  banned: "permission-denied",
  bad_request: "invalid-argument",
  bad_items: "invalid-argument",
  bad_note: "invalid-argument",
  bad_price: "invalid-argument",
  bad_edition: "invalid-argument",
  license_required: "invalid-argument",
  offer_limit: "resource-exhausted",
  trade_limit: "resource-exhausted",
  already_exists: "already-exists",
  already_owned: "already-exists",
  already_claimed: "already-exists",
  already_entered: "already-exists",
};

function toHttps(err: ClosetError): HttpsError {
  return new HttpsError(CODE_MAP[err.code] ?? "failed-precondition", err.code);
}

export function id(value: unknown): string {
  if (!isId(value)) throw new HttpsError("invalid-argument", "bad_request");
  return value;
}

export function actorFrom(request: CallableRequest, nowMs: number): ClosetActor {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "unauthenticated");
  if (!request.app) throw new HttpsError("failed-precondition", "app_check_required");
  const token: Record<string, unknown> = request.auth?.token ?? {};
  const fb = (token.firebase ?? {}) as { sign_in_second_factor?: unknown; sign_in_provider?: unknown };
  return {
    uid,
    nowMs,
    emailVerified: token.email_verified === true,
    secondFactor: typeof fb.sign_in_second_factor === "string" && fb.sign_in_second_factor.length > 0,
    provider: str(fb.sign_in_provider),
    isAdmin: token.admin === true,
  };
}

async function run<T>(
  name: string,
  request: CallableRequest,
  deps: ClosetDeps,
  gate: ClosetFeature | "admin",
  fn: (actor: ClosetActor, body: Body) => Promise<T>,
): Promise<T> {
  const actor = actorFrom(request, deps.nowMs);
  if (gate === "admin") {
    if (!actor.isAdmin) throw new HttpsError("permission-denied", "not_admin");
  } else if (!closetAllowed(actor.uid, deps.flags, gate)) {
    throw new HttpsError("failed-precondition", "closet_disabled");
  }
  const body: Body = request.data && typeof request.data === "object" ? (request.data as Body) : {};
  try {
    return await fn(actor, body);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    if (err instanceof ClosetError) throw toHttps(err);
    logger.error("closet_call_failed", { name, message: err instanceof Error ? err.message : "unknown" });
    throw new HttpsError("internal", "closet_failed");
  }
}

export const handleClaimDrop = (r: CallableRequest, d: ClosetDeps) =>
  run("claimDrop", r, d, "drops", (a, b) => claimDrop(d.db, a, id(b.dropId)));

export const handleEnterDraw = (r: CallableRequest, d: ClosetDeps) =>
  run("enterDraw", r, d, "drops", (a, b) => enterDraw(d.db, a, id(b.dropId)));

export const handleBuyShopItem = (r: CallableRequest, d: ClosetDeps) =>
  run("buyShopItem", r, d, "closet", (a, b) => buyShopItem(d.db, a, id(b.itemDefId)));

export const handleEquipItem = (r: CallableRequest, d: ClosetDeps) =>
  run("equipItem", r, d, "closet", (a, b) => equipItem(d.db, a.uid, id(b.copyId), b.equip !== false));

export const handleProposeTrade = (r: CallableRequest, d: ClosetDeps) =>
  run("proposeTrade", r, d, "trading", (a, b) => proposeTrade(d.db, a, b));

export const handleRespondTrade = (r: CallableRequest, d: ClosetDeps) =>
  run("respondTrade", r, d, "trading", (a, b) => {
    const tradeId = id(b.tradeId);
    switch (b.response) {
      case "accept":
      case "decline":
      case "cancel":
        return respondTrade(d.db, a, tradeId, b.response);
      case "counter":
        return proposeTrade(d.db, a, b, tradeId);
      default:
        throw new HttpsError("invalid-argument", "bad_request");
    }
  });

export const handleConfirmTrade = (r: CallableRequest, d: ClosetDeps) =>
  run("confirmTrade", r, d, "trading", (a, b) => confirmTrade(d.db, a, id(b.tradeId)));

export const handleIapVerify = (r: CallableRequest, d: ClosetDeps) =>
  run("iapVerify", r, d, "bucksPurchase", (a, b) =>
    iapVerify(d.db, a, b as { platform: unknown; receipt: unknown }, d.verifier ?? unconfiguredVerifier),
  );

/**
 * Admin-only award path for check-ins, weekly challenges, What's That Trick
 * and level-ups (game awards run from the stats trigger). The target must be
 * inside the closet gate, so nothing reaches the public while the flag is off.
 */
export const handleAwardEarn = (r: CallableRequest, d: ClosetDeps) =>
  run("awardEarn", r, d, "admin", (_a, b): Promise<unknown> => {
    const uid = id(b.uid);
    if (!closetAllowed(uid, d.flags, "closet")) throw new HttpsError("failed-precondition", "closet_disabled");
    if (b.event === "item_unlock") return grantEarnedItem(d.db, uid, id(b.itemDefId), `unlock:${id(b.ref)}`, d.nowMs);
    return awardEarn(d.db, b, d.nowMs);
  });

/**
 * Game close-out Bucks, called from onGameCompleted after the stats
 * transaction. Never throws: a failed award is logged and must not retry or
 * block the stats close-out. Awards are idempotent per game, so a retried
 * trigger cannot pay twice.
 */
export async function handleGameEarn(
  db: ClosetDb,
  flags: ClosetFlags,
  gameId: string,
  game: Record<string, unknown>,
  nowMs: number,
): Promise<void> {
  const allowed = (uid: string): boolean => closetAllowed(uid, flags, "closet");
  if (!allowed(str(game.player1Uid)) && !allowed(str(game.player2Uid))) return;
  try {
    await awardGameEarn(db, gameId, game, nowMs, allowed);
  } catch (err) {
    logger.error("closet_game_earn_failed", { gameId, message: err instanceof Error ? err.message : "unknown" });
  }
}

/** Admin catalog and support actions. Not behind the kill switch so the catalog can be staged. */
export const handleClosetAdmin = (r: CallableRequest, d: ClosetDeps) =>
  run("closetAdmin", r, d, "admin", (a, b): Promise<unknown> => {
    switch (b.action) {
      case "createItem":
        return createItem(d.db, a, id(b.itemDefId), (b.item ?? {}) as Body);
      case "updateStock":
        return updateStock(d.db, a, id(b.itemDefId), b.supply);
      case "retireItem":
        return retireItem(d.db, a, id(b.itemDefId));
      case "createDrop":
        return createDrop(d.db, a, id(b.dropId), (b.drop ?? {}) as Body);
      case "reverseTrade":
        return reverseTrade(d.db, a, id(b.tradeId), b.reason);
      case "auditWallet":
        return auditWallet(d.db, id(b.uid));
      case "iapRefund":
        return iapRefund(d.db, id(b.uid), b.platform, b.transactionId, d.nowMs);
      default:
        throw new HttpsError("invalid-argument", "bad_request");
    }
  });
