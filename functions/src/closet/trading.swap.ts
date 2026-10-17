/**
 * The atomic part of a trade. Reads every copy (and its serial row) for both
 * sides first, then moves them all in the same transaction: delete from the
 * giver, recreate under the receiver with the giver appended to provenance,
 * a fresh 7-day cooldown, and the serial ledger's owner + history updated.
 */
import { PREV_OWNERS_CAP, SERIAL_HISTORY_CAP, TRADE_FEE, TRADE_ITEM_COOLDOWN_DAYS } from "./economy.js";
import { ClosetError, DAY_MS, paths, str, ts } from "./model.js";
import type { ClosetTx } from "./store.js";
import { checkCopy, type ItemMode, type TradeItem } from "./trading.rules.js";
import { credit, readWallet, type Wallet } from "./wallet.js";

export interface MoveRow {
  fromUid: string;
  toUid: string;
  copyId: string;
  data: Record<string, unknown> | undefined;
  receiverHas: boolean;
  serialPath: string | null;
  serialData: Record<string, unknown> | undefined;
}

export interface TradeSides {
  fromUid: string;
  toUid: string;
  give: readonly TradeItem[];
  get: readonly TradeItem[];
}

function itemList(raw: unknown): TradeItem[] {
  return Array.isArray(raw) ? (raw as TradeItem[]) : [];
}

export function sidesOf(trade: Record<string, unknown>): TradeSides {
  return { fromUid: str(trade.fromUid), toUid: str(trade.toUid), give: itemList(trade.give), get: itemList(trade.get) };
}

/** Reads only, never throws on missing docs, so a failed release can still clean up. */
export async function readMoves(tx: ClosetTx, sides: TradeSides): Promise<MoveRow[]> {
  const plan = [
    ...sides.give.map((item) => ({ item, fromUid: sides.fromUid, toUid: sides.toUid })),
    ...sides.get.map((item) => ({ item, fromUid: sides.toUid, toUid: sides.fromUid })),
  ];
  const rows: MoveRow[] = [];
  for (const { item, fromUid, toUid } of plan) {
    const data = (await tx.get(paths.copy(fromUid, item.copyId))).data;
    const receiverHas = (await tx.get(paths.copy(toUid, item.copyId))).data !== undefined;
    const serial = typeof data?.serial === "number" ? data.serial : null;
    const serialPath = serial === null ? null : paths.serial(str(data?.itemDefId), serial);
    const serialData = serialPath === null ? undefined : (await tx.get(serialPath)).data;
    rows.push({ fromUid, toUid, copyId: item.copyId, data, receiverHas, serialPath, serialData });
  }
  return rows;
}

export function validateMoves(rows: readonly MoveRow[], nowMs: number, mode: ItemMode, tradeId: string): void {
  for (const row of rows) {
    checkCopy(row.copyId, row.data, nowMs, mode, mode === "release" ? tradeId : null);
    if (row.receiverHas) throw new ClosetError("already_owned");
  }
}

export function writeMoves(tx: ClosetTx, rows: readonly MoveRow[], tradeId: string, nowMs: number): void {
  const at = ts(nowMs);
  for (const row of rows) {
    const data: Record<string, unknown> = { ...row.data };
    delete data.lockedByTrade;
    const prov = (data.provenance ?? {}) as Record<string, unknown>;
    const prevOwners = Array.isArray(prov.prevOwners) ? (prov.prevOwners as unknown[]) : [];
    tx.delete(paths.copy(row.fromUid, row.copyId));
    tx.set(paths.copy(row.toUid, row.copyId), {
      ...data,
      equipped: false,
      acquiredAt: at,
      tradableAfter: ts(nowMs + TRADE_ITEM_COOLDOWN_DAYS * DAY_MS),
      provenance: { ...prov, prevOwners: [...prevOwners, row.fromUid].slice(-PREV_OWNERS_CAP) },
    });
    if (row.serialPath !== null && row.serialData) {
      const history = Array.isArray(row.serialData.history) ? (row.serialData.history as unknown[]) : [];
      tx.update(row.serialPath, {
        ownerUid: row.toUid,
        history: [...history, { uid: row.toUid, at, reason: "trade", tradeId }].slice(-SERIAL_HISTORY_CAP),
      });
    }
  }
}

export function lockMoves(tx: ClosetTx, rows: readonly MoveRow[], tradeId: string): void {
  for (const row of rows) tx.update(paths.copy(row.fromUid, row.copyId), { lockedByTrade: tradeId });
}

/** Only unlock copies this trade locked; never touch another trade's lock. */
export function unlockMoves(tx: ClosetTx, rows: readonly MoveRow[], tradeId: string): void {
  for (const row of rows) {
    if (str(row.data?.lockedByTrade) === tradeId)
      tx.update(paths.copy(row.fromUid, row.copyId), { lockedByTrade: null });
  }
}

export async function readBothWallets(tx: ClosetTx, sides: TradeSides): Promise<[Wallet, Wallet]> {
  return [await readWallet(tx, sides.fromUid), await readWallet(tx, sides.toUid)];
}

/** Return both trade fees after a failed or reversed hold. */
export function refundFees(
  tx: ClosetTx,
  sides: TradeSides,
  wallets: [Wallet, Wallet],
  tradeId: string,
  nowMs: number,
): void {
  const note = { reason: "trade_fee_refund", ref: tradeId };
  credit(tx, sides.fromUid, wallets[0], TRADE_FEE, "earned", note, `trade_refund_${tradeId}`, nowMs);
  credit(tx, sides.toUid, wallets[1], TRADE_FEE, "earned", note, `trade_refund_${tradeId}`, nowMs);
}
