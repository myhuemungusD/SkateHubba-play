/**
 * Closet part of account erasure: trades, serial ownership and drop entries.
 * The wallet, ledger, locker and design subcollections under users/{uid} go
 * with the identity phase in `_deleteUserData.ts`.
 *
 * Trades are shared with another skater, so they are settled and then
 * anonymized rather than deleted (see `_anonymize.ts`):
 *   • pending / accepted: nothing has moved and no fee was taken, so the
 *     trade is simply cancelled.
 *   • held: both fees were taken and both sides' items are locked to the
 *     trade. The other skater's items are unlocked and their fee refunded,
 *     exactly as the closet's own failed-hold unwind does
 *     (functions/src/closet/trading.holds.ts), with the same ledger id so a
 *     later sweep can never refund twice. The departing account's copies and
 *     wallet are deleted with the rest of its data, so nothing moves to or
 *     from it.
 *   • finished (completed, declined, failed, reversed...): kept for the other
 *     skater with this account replaced by the tombstone.
 */
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { DELETED_UID, scrubUid } from "./_anonymize.js";
import { commitWrites, numField, scanAll } from "./_cascadeUtil.js";

/** Mirrors TRADE_FEE in functions/src/closet/economy.ts (duplicated so Vercel does not import functions/). */
export const TRADE_FEE = 10;

export interface ClosetErasureCounts {
  /** Open trades (pending, accepted or held) closed because this account left. */
  tradesSettled: number;
  /** Trades kept for the other skater with this account anonymized. */
  tradesAnonymized: number;
  /** Trades deleted because both sides are gone. */
  tradesDeleted: number;
  /** Serial ledger rows whose current owner was this account. */
  serials: number;
  /** drops/{id}/claims/{uid} and drops/{id}/entries/{uid} docs deleted. */
  dropRecords: number;
}

interface TradeItemRef {
  copyId: string;
}

function itemIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as TradeItemRef[]).map((item) => item?.copyId).filter((id): id is string => typeof id === "string");
}

type Settled = { settled: boolean; kept: boolean } | null;

async function settleTrade(
  db: Firestore,
  ref: FirebaseFirestore.DocumentReference,
  uid: string,
  nowMs: number,
): Promise<Settled> {
  return db.runTransaction(async (tx) => {
    // ── reads ──
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const trade = (snap.data() ?? {}) as Record<string, unknown>;
    const from = typeof trade.fromUid === "string" ? trade.fromUid : null;
    const to = typeof trade.toUid === "string" ? trade.toUid : null;
    const other = from === uid ? to : from;
    const status = trade.status;
    const at = Timestamp.fromMillis(nowMs);
    const live = other !== null && other !== uid && other !== DELETED_UID;

    let patch: Record<string, unknown> | null = null;
    const otherWrites: (() => void)[] = [];
    if (status === "pending" || status === "accepted") {
      patch = { status: "cancelled", cancelReason: "account_deleted", updatedAt: at };
    } else if (status === "held") {
      patch = { status: "failed", failReason: "account_deleted", updatedAt: at };
      if (live) {
        // The other skater's side of the swap: `give` when they proposed, `get` when they received.
        const theirIds = itemIds(other === from ? trade.give : trade.get);
        const copies = await Promise.all(
          theirIds.map((id) => tx.get(db.collection("users").doc(other).collection("locker").doc(id))),
        );
        const walletRef = db.collection("users").doc(other).collection("wallet").doc("main");
        const ledgerRef = db.collection("users").doc(other).collection("ledger").doc(`trade_refund_${ref.id}`);
        const [walletSnap, ledgerSnap] = [await tx.get(walletRef), await tx.get(ledgerRef)];
        for (const copy of copies) {
          if (copy.exists && (copy.data() as Record<string, unknown>).lockedByTrade === ref.id) {
            otherWrites.push(() => tx.update(copy.ref, { lockedByTrade: null }));
          }
        }
        if (!ledgerSnap.exists) {
          const wallet = (walletSnap.data() ?? {}) as Record<string, unknown>;
          const balance = numField(wallet, "balance") + TRADE_FEE;
          otherWrites.push(() => {
            tx.set(walletRef, {
              balance,
              earnedBal: numField(wallet, "earnedBal") + TRADE_FEE,
              boughtBal: numField(wallet, "boughtBal"),
              updatedAt: at,
            });
            tx.set(ledgerRef, {
              kind: "credit",
              amount: TRADE_FEE,
              earned: TRADE_FEE,
              bought: 0,
              reason: "trade_fee_refund",
              ref: ref.id,
              balanceAfter: balance,
              createdAt: at,
            });
          });
        }
      }
    }

    // ── writes ──
    for (const write of otherWrites) write();
    if (!live) {
      tx.delete(ref);
      return { settled: patch !== null, kept: false };
    }
    // A note on an offer this account proposed is its own words, so it goes too.
    const authored = from === uid ? { note: "" } : {};
    tx.set(ref, scrubUid({ ...trade, ...(patch ?? {}), ...authored }, uid) as Record<string, unknown>);
    return { settled: patch !== null, kept: true };
  });
}

export function emptyClosetCounts(): ClosetErasureCounts {
  return { tradesSettled: 0, tradesAnonymized: 0, tradesDeleted: 0, serials: 0, dropRecords: 0 };
}

export async function eraseCloset(db: Firestore, uid: string, nowMs: number): Promise<ClosetErasureCounts> {
  const counts = emptyClosetCounts();

  const trades = db.collection("trades");
  const [sent, received] = await Promise.all([
    scanAll(trades.where("fromUid", "==", uid)),
    scanAll(trades.where("toUid", "==", uid)),
  ]);
  const seen = new Set<string>();
  for (const snap of [...sent, ...received]) {
    if (seen.has(snap.id)) continue;
    seen.add(snap.id);
    const outcome = await settleTrade(db, snap.ref, uid, nowMs);
    if (outcome === null) continue;
    if (outcome.settled) counts.tradesSettled += 1;
    if (outcome.kept) counts.tradesAnonymized += 1;
    else counts.tradesDeleted += 1;
  }

  // Serial rows are public provenance for a numbered item. The copy itself
  // leaves with the locker; the row stays so the serial's history is intact,
  // but the owner and every history entry naming this account are anonymized.
  const serials = await scanAll(db.collection("serials").where("ownerUid", "==", uid));
  counts.serials = await commitWrites(
    db,
    serials.map((s) => ({
      ref: s.ref,
      kind: "set" as const,
      data: scrubUid(s.data(), uid) as Record<string, unknown>,
    })),
  );

  // Drop claims and raffle entries are keyed by uid under each drop. Drops are
  // a handful of weekly releases, so a full scan is cheap.
  const drops = await scanAll(db.collection("drops"));
  for (const drop of drops) {
    for (const sub of ["claims", "entries"]) {
      const ref = drop.ref.collection(sub).doc(uid);
      if (!(await ref.get()).exists) continue;
      await ref.delete();
      counts.dropRecords += 1;
    }
  }
  return counts;
}
