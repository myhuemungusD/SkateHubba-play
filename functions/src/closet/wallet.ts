/**
 * Hubba Bucks wallet. One balance on screen, but earned and bought Bucks are
 * tracked separately so a refund can claw back bought Bucks only. Every
 * change writes an append-only ledger row in the same transaction, so the
 * balance always equals the ledger sum (see {@link auditWallet}).
 *
 * Spending takes earned Bucks first. A clawback can push the balance below
 * zero, which blocks spending until it is earned back.
 */
import { ClosetError, num, paths, ts, utcDay } from "./model.js";
import type { ClosetDb, ClosetTx } from "./store.js";

export interface Wallet {
  balance: number;
  earnedBal: number;
  boughtBal: number;
}

export type Bucket = "earned" | "bought";

export interface LedgerNote {
  reason: string;
  ref: string | null;
}

export async function readWallet(tx: ClosetTx, uid: string): Promise<Wallet> {
  const doc = await tx.get(paths.wallet(uid));
  const data = doc.data ?? {};
  return { balance: num(data.balance), earnedBal: num(data.earnedBal), boughtBal: num(data.boughtBal) };
}

/** True when a ledger row with this id exists (idempotency for awards and receipts). */
export async function ledgerExists(tx: ClosetTx, uid: string, txId: string): Promise<boolean> {
  return (await tx.get(paths.ledger(uid, txId))).data !== undefined;
}

function write(
  tx: ClosetTx,
  uid: string,
  next: Wallet,
  row: { kind: string; earned: number; bought: number; note: LedgerNote; txId: string; nowMs: number },
): Wallet {
  const at = ts(row.nowMs);
  tx.set(paths.wallet(uid), { ...next, updatedAt: at });
  tx.set(paths.ledger(uid, row.txId), {
    kind: row.kind,
    amount: row.earned + row.bought,
    earned: row.earned,
    bought: row.bought,
    reason: row.note.reason,
    ref: row.note.ref,
    balanceAfter: next.balance,
    createdAt: at,
  });
  return next;
}

export function canAfford(wallet: Wallet, amount: number): boolean {
  return wallet.balance >= 0 && wallet.balance >= amount;
}

export function debit(
  tx: ClosetTx,
  uid: string,
  wallet: Wallet,
  amount: number,
  note: LedgerNote,
  txId: string,
  nowMs: number,
): Wallet {
  if (!Number.isInteger(amount) || amount < 0) throw new ClosetError("bad_request");
  if (!canAfford(wallet, amount)) throw new ClosetError("insufficient_bucks");
  const fromEarned = Math.min(amount, Math.max(wallet.earnedBal, 0));
  const fromBought = amount - fromEarned;
  const next = {
    balance: wallet.balance - amount,
    earnedBal: wallet.earnedBal - fromEarned,
    boughtBal: wallet.boughtBal - fromBought,
  };
  return write(tx, uid, next, { kind: "debit", earned: -fromEarned, bought: -fromBought, note, txId, nowMs });
}

export function credit(
  tx: ClosetTx,
  uid: string,
  wallet: Wallet,
  amount: number,
  bucket: Bucket,
  note: LedgerNote,
  txId: string,
  nowMs: number,
): Wallet {
  // Zero is allowed: a capped award still writes its row so a retry stays a no-op.
  if (!Number.isInteger(amount) || amount < 0) throw new ClosetError("bad_request");
  const earned = bucket === "earned" ? amount : 0;
  const bought = bucket === "bought" ? amount : 0;
  const next = {
    balance: wallet.balance + amount,
    earnedBal: wallet.earnedBal + earned,
    boughtBal: wallet.boughtBal + bought,
  };
  return write(tx, uid, next, { kind: "credit", earned, bought, note, txId, nowMs });
}

/** Refund clawback of bought Bucks. May leave a negative balance. */
export function clawback(
  tx: ClosetTx,
  uid: string,
  wallet: Wallet,
  amount: number,
  note: LedgerNote,
  txId: string,
  nowMs: number,
): Wallet {
  if (!Number.isInteger(amount) || amount <= 0) throw new ClosetError("bad_request");
  const next = { balance: wallet.balance - amount, earnedBal: wallet.earnedBal, boughtBal: wallet.boughtBal - amount };
  return write(tx, uid, next, { kind: "clawback", earned: 0, bought: -amount, note, txId, nowMs });
}

export interface WalletAudit {
  balance: number;
  ledgerSum: number;
  rows: number;
  ok: boolean;
}

/** Compare the stored balance with the ledger sum. Read-only. */
export async function auditWallet(db: ClosetDb, uid: string): Promise<WalletAudit> {
  const wallet = await db.get(paths.wallet(uid));
  const rows = await db.query({ collection: `users/${uid}/ledger`, filters: [] });
  const ledgerSum = rows.reduce((sum, row) => sum + num(row.data?.amount), 0);
  const balance = num(wallet.data?.balance);
  return { balance, ledgerSum, rows: rows.length, ok: balance === ledgerSum };
}

/** Server-only per-UTC-day counters for earn caps and trade rate limits. */
export interface DailyLimits {
  day: number;
  earnedToday: number;
  earnCounts: Record<string, number>;
  oppCounts: Record<string, number>;
  offers: number;
  trades: number;
}

function counts(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = num(v);
  return out;
}

export async function readLimits(tx: ClosetTx, uid: string, nowMs: number): Promise<DailyLimits> {
  const day = utcDay(nowMs);
  const data = (await tx.get(paths.limits(uid))).data;
  if (!data || data.day !== day) {
    return { day, earnedToday: 0, earnCounts: {}, oppCounts: {}, offers: 0, trades: 0 };
  }
  return {
    day,
    earnedToday: num(data.earnedToday),
    earnCounts: counts(data.earnCounts),
    oppCounts: counts(data.oppCounts),
    offers: num(data.offers),
    trades: num(data.trades),
  };
}

export function writeLimits(tx: ClosetTx, uid: string, limits: DailyLimits): void {
  tx.set(paths.limits(uid), { ...limits });
}
