/**
 * Trading: item-for-item only, never Bucks. Offer → accept (or counter) →
 * both confirm → one transaction swaps everything, or puts it on hold.
 *
 * Guards (plan §6): 14+ day account, 5+ games, verified email and 2-step
 * (or Google / Apple sign-in) for both sides; 7-day cooldown on newly
 * acquired items; 10 offers and 3 completed trades per day; a flat 10 Bucks
 * fee per side; a rarity-imbalance acknowledgement; filtered notes. If
 * either side confirmed without a second factor, the items are locked for a
 * 3-day hold, during which an admin can reverse the trade.
 *
 * Status: pending → accepted → (held →) completed
 *         pending → declined | cancelled | countered | expired
 *         accepted → cancelled;  held → failed | reversed
 */
import { assertAccount, assertTradeSecurity, TRADE_RULE } from "./access.js";
import {
  isImbalanced,
  TRADE_FEE,
  TRADE_HOLD_DAYS,
  TRADE_OFFER_TTL_DAYS,
  TRADE_OFFERS_PER_DAY,
  TRADES_COMPLETED_PER_DAY,
} from "./economy.js";
import { ClosetError, DAY_MS, isId, paths, str, toMillis, ts, type ClosetActor } from "./model.js";
import type { ClosetDb, ClosetTx } from "./store.js";
import { checkCopy, cleanNote, copyIdList, type TradeItem } from "./trading.rules.js";
import {
  lockMoves,
  readBothWallets,
  readMoves,
  sidesOf,
  validateMoves,
  writeMoves,
  type TradeSides,
} from "./trading.swap.js";
import { canAfford, debit, readLimits, readWallet, writeLimits } from "./wallet.js";

export interface TradeResult {
  tradeId: string;
  status: string;
  imbalanced?: boolean;
}

export interface ProposeInput {
  toUid?: unknown;
  give?: unknown;
  get?: unknown;
  note?: unknown;
  ackImbalance?: unknown;
}

async function assertNotBlocked(tx: ClosetTx, a: string, b: string): Promise<void> {
  if ((await tx.get(`users/${a}/blocked_users/${b}`)).data) throw new ClosetError("not_eligible");
  if ((await tx.get(`users/${b}/blocked_users/${a}`)).data) throw new ClosetError("not_eligible");
}

async function readItems(tx: ClosetTx, owner: string, ids: readonly string[], nowMs: number): Promise<TradeItem[]> {
  const items: TradeItem[] = [];
  for (const id of ids) items.push(checkCopy(id, (await tx.get(paths.copy(owner, id))).data, nowMs, "offer", null));
  return items;
}

export async function proposeTrade(
  db: ClosetDb,
  actor: ClosetActor,
  input: ProposeInput,
  counterOf: string | null = null,
): Promise<TradeResult> {
  if (!isId(input.toUid) || input.toUid === actor.uid) throw new ClosetError("bad_request");
  const toUid = input.toUid;
  const giveIds = copyIdList(input.give);
  const getIds = copyIdList(input.get);
  const note = cleanNote(input.note);
  assertTradeSecurity(actor);
  const tradeId = db.newId("trades");

  return db.runTransaction(async (tx) => {
    const original = counterOf === null ? undefined : (await tx.get(paths.trade(counterOf))).data;
    if (counterOf !== null) {
      if (!original) throw new ClosetError("not_found");
      if (original.toUid !== actor.uid || original.fromUid !== toUid) throw new ClosetError("not_party");
      if (original.status !== "pending") throw new ClosetError("not_pending");
    }
    await assertAccount(tx, actor.uid, actor.nowMs, TRADE_RULE);
    await assertAccount(tx, toUid, actor.nowMs, TRADE_RULE);
    await assertNotBlocked(tx, actor.uid, toUid);
    const limits = await readLimits(tx, actor.uid, actor.nowMs);
    if (limits.offers >= TRADE_OFFERS_PER_DAY) throw new ClosetError("offer_limit");
    if (!canAfford(await readWallet(tx, actor.uid), TRADE_FEE)) throw new ClosetError("insufficient_bucks");
    const give = await readItems(tx, actor.uid, giveIds, actor.nowMs);
    const get = await readItems(tx, toUid, getIds, actor.nowMs);
    const imbalanced = isImbalanced(
      give.map((i) => i.rarity),
      get.map((i) => i.rarity),
    );
    if (imbalanced && input.ackImbalance !== true) throw new ClosetError("rarity_imbalance");

    if (counterOf !== null) tx.update(paths.trade(counterOf), { status: "countered", updatedAt: ts(actor.nowMs) });
    tx.set(paths.trade(tradeId), {
      fromUid: actor.uid,
      toUid,
      parties: [actor.uid, toUid],
      give,
      get,
      note,
      imbalanced,
      status: "pending",
      confirmedBy: [],
      secondFactor: {},
      counterOf,
      createdAt: ts(actor.nowMs),
      updatedAt: ts(actor.nowMs),
      expiresAt: ts(actor.nowMs + TRADE_OFFER_TTL_DAYS * DAY_MS),
    });
    limits.offers += 1;
    writeLimits(tx, actor.uid, limits);
    return { tradeId, status: "pending", imbalanced };
  });
}

function expired(trade: Record<string, unknown>, nowMs: number): boolean {
  const at = toMillis(trade.expiresAt);
  return at !== null && at <= nowMs;
}

export type TradeResponse = "accept" | "decline" | "cancel";

export async function respondTrade(
  db: ClosetDb,
  actor: ClosetActor,
  tradeId: string,
  response: TradeResponse,
): Promise<TradeResult> {
  if (response === "accept") assertTradeSecurity(actor);
  return db.runTransaction(async (tx) => {
    const trade = (await tx.get(paths.trade(tradeId))).data;
    if (!trade) throw new ClosetError("not_found");
    const isTo = trade.toUid === actor.uid;
    if (!isTo && trade.fromUid !== actor.uid) throw new ClosetError("not_party");
    const open = trade.status === "pending" || (response === "cancel" && trade.status === "accepted");
    if (!open) throw new ClosetError("not_pending");
    if (response === "accept") await assertAccount(tx, actor.uid, actor.nowMs, TRADE_RULE);
    const at = ts(actor.nowMs);
    if (trade.status === "pending" && expired(trade, actor.nowMs)) {
      tx.update(paths.trade(tradeId), { status: "expired", updatedAt: at });
      return { tradeId, status: "expired" };
    }
    if (response !== "cancel" && !isTo) throw new ClosetError("not_party");
    const status = response === "accept" ? "accepted" : response === "decline" ? "declined" : "cancelled";
    tx.update(paths.trade(tradeId), { status, updatedAt: at });
    return { tradeId, status };
  });
}

async function finish(
  tx: ClosetTx,
  sides: TradeSides,
  tradeId: string,
  secondFactor: Record<string, boolean>,
  nowMs: number,
): Promise<string> {
  await assertAccount(tx, sides.fromUid, nowMs, TRADE_RULE);
  await assertAccount(tx, sides.toUid, nowMs, TRADE_RULE);
  const fromLimits = await readLimits(tx, sides.fromUid, nowMs);
  const toLimits = await readLimits(tx, sides.toUid, nowMs);
  if (fromLimits.trades >= TRADES_COMPLETED_PER_DAY || toLimits.trades >= TRADES_COMPLETED_PER_DAY) {
    throw new ClosetError("trade_limit");
  }
  const [fromWallet, toWallet] = await readBothWallets(tx, sides);
  const rows = await readMoves(tx, sides);
  validateMoves(rows, nowMs, "offer", tradeId);

  const fee = { reason: "trade_fee", ref: tradeId };
  debit(tx, sides.fromUid, fromWallet, TRADE_FEE, fee, `trade_fee_${tradeId}`, nowMs);
  debit(tx, sides.toUid, toWallet, TRADE_FEE, fee, `trade_fee_${tradeId}`, nowMs);
  fromLimits.trades += 1;
  toLimits.trades += 1;
  writeLimits(tx, sides.fromUid, fromLimits);
  writeLimits(tx, sides.toUid, toLimits);

  const hold = secondFactor[sides.fromUid] !== true || secondFactor[sides.toUid] !== true;
  const base = { confirmedBy: [sides.fromUid, sides.toUid], secondFactor, updatedAt: ts(nowMs) };
  if (hold) {
    lockMoves(tx, rows, tradeId);
    tx.update(paths.trade(tradeId), { ...base, status: "held", releaseAt: ts(nowMs + TRADE_HOLD_DAYS * DAY_MS) });
    return "held";
  }
  writeMoves(tx, rows, tradeId, nowMs);
  tx.update(paths.trade(tradeId), { ...base, status: "completed", completedAt: ts(nowMs) });
  return "completed";
}

export async function confirmTrade(db: ClosetDb, actor: ClosetActor, tradeId: string): Promise<TradeResult> {
  assertTradeSecurity(actor);
  return db.runTransaction(async (tx) => {
    const trade = (await tx.get(paths.trade(tradeId))).data;
    if (!trade) throw new ClosetError("not_found");
    const sides = sidesOf(trade);
    if (actor.uid !== sides.fromUid && actor.uid !== sides.toUid) throw new ClosetError("not_party");
    if (trade.status !== "accepted") throw new ClosetError("not_accepted");
    const confirmed = Array.isArray(trade.confirmedBy) ? trade.confirmedBy.map(str) : [];
    if (confirmed.includes(actor.uid)) throw new ClosetError("already_confirmed");
    const secondFactor = { ...(trade.secondFactor as Record<string, boolean>), [actor.uid]: actor.secondFactor };
    const other = actor.uid === sides.fromUid ? sides.toUid : sides.fromUid;
    if (confirmed.includes(other)) {
      return { tradeId, status: await finish(tx, sides, tradeId, secondFactor, actor.nowMs) };
    }
    await assertAccount(tx, actor.uid, actor.nowMs, TRADE_RULE);
    tx.update(paths.trade(tradeId), {
      confirmedBy: [...confirmed, actor.uid],
      secondFactor,
      updatedAt: ts(actor.nowMs),
    });
    return { tradeId, status: "accepted" };
  });
}
