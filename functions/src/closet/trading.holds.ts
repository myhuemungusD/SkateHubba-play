/**
 * Trade holds. A held trade's items stay with their owners, locked to the
 * trade, until `releaseAt`. The scheduled sweep then swaps them; if a copy
 * went missing the trade fails, locks are cleared and both fees refunded.
 * An admin can reverse a held trade (stolen account) the same way.
 */
import { logger } from "firebase-functions/logger";
import { writeAudit } from "./catalog.js";
import { ClosetError, paths, toMillis, ts, type ClosetActor } from "./model.js";
import type { ClosetDb, ClosetTx } from "./store.js";
import { cleanNote } from "./trading.rules.js";
import {
  readBothWallets,
  readMoves,
  refundFees,
  sidesOf,
  unlockMoves,
  validateMoves,
  writeMoves,
  type MoveRow,
} from "./trading.swap.js";

interface HeldTrade {
  rows: MoveRow[];
  unwind: (status: string, extra: Record<string, unknown>) => void;
}

/** Read everything a hold needs (reads only), and return a writer that unwinds it. */
async function readHold(
  tx: ClosetTx,
  trade: Record<string, unknown>,
  tradeId: string,
  nowMs: number,
): Promise<HeldTrade> {
  const sides = sidesOf(trade);
  const wallets = await readBothWallets(tx, sides);
  const rows = await readMoves(tx, sides);
  const unwind = (status: string, extra: Record<string, unknown>): void => {
    unlockMoves(tx, rows, tradeId);
    refundFees(tx, sides, wallets, tradeId, nowMs);
    tx.update(paths.trade(tradeId), { ...extra, status, updatedAt: ts(nowMs) });
  };
  return { rows, unwind };
}

/** Release one held trade. Returns the new status, or null when not due. */
export async function releaseHold(db: ClosetDb, tradeId: string, nowMs: number): Promise<string | null> {
  return db.runTransaction(async (tx) => {
    const trade = (await tx.get(paths.trade(tradeId))).data;
    const releaseAt = toMillis(trade?.releaseAt);
    if (!trade || trade.status !== "held" || releaseAt === null || releaseAt > nowMs) return null;
    const { rows, unwind } = await readHold(tx, trade, tradeId, nowMs);
    try {
      validateMoves(rows, nowMs, "release", tradeId);
    } catch (err) {
      if (!(err instanceof ClosetError)) throw err;
      unwind("failed", { failReason: err.code });
      return "failed";
    }
    writeMoves(tx, rows, tradeId, nowMs);
    tx.update(paths.trade(tradeId), { status: "completed", completedAt: ts(nowMs), updatedAt: ts(nowMs) });
    return "completed";
  });
}

/** Scheduled sweep over held trades. Held trades are few, so the date filter runs in memory. */
export async function releaseTradeHolds(db: ClosetDb, nowMs: number): Promise<number> {
  const held = await db.query({ collection: "trades", filters: [{ field: "status", op: "==", value: "held" }] });
  let released = 0;
  for (const row of held) {
    const at = toMillis(row.data?.releaseAt);
    if (at === null || at > nowMs) continue;
    try {
      if ((await releaseHold(db, row.id, nowMs)) !== null) released += 1;
    } catch (err) {
      logger.error("closet_hold_release_failed", {
        tradeId: row.id,
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  return released;
}

/** Admin: undo a held trade (e.g. a stolen account). Items stay put, fees come back. */
export async function reverseTrade(
  db: ClosetDb,
  actor: ClosetActor,
  tradeId: string,
  rawReason: unknown,
): Promise<{ tradeId: string; status: string }> {
  const reason = cleanNote(rawReason);
  if (!reason) throw new ClosetError("bad_request");
  return db.runTransaction(async (tx) => {
    const trade = (await tx.get(paths.trade(tradeId))).data;
    if (!trade) throw new ClosetError("not_found");
    if (trade.status !== "held") throw new ClosetError("not_held");
    const { unwind } = await readHold(tx, trade, tradeId, actor.nowMs);
    unwind("reversed", { reversedBy: actor.uid, reverseReason: reason });
    writeAudit(tx, db, actor, "reverse_trade", tradeId, { reason });
    return { tradeId, status: "reversed" };
  });
}
