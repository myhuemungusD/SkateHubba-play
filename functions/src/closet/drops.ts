/**
 * Limited drop claims. One transaction checks the drop is live, the skater
 * is eligible and has not claimed, supply is left and the balance covers the
 * price, then mints the next serial, debits Bucks and records the claim.
 * All or nothing.
 *
 * Draw drops (Grail) reuse this path: only an entry marked `won` by
 * {@link runDraw} can claim, inside the claim window.
 */
import { assertAccount, DROP_RULE } from "./access.js";
import { applyMint, prepareMint } from "./mint.js";
import { ClosetError, num, paths, str, toMillis, ts, type ClosetActor } from "./model.js";
import type { ClosetDb } from "./store.js";
import { canAfford, debit, readWallet } from "./wallet.js";

export interface ClaimResult {
  copyId: string;
  serial: number | null;
  supply: number | null;
  balance: number;
}

function liveWindow(drop: Record<string, unknown>, nowMs: number): boolean {
  const start = toMillis(drop.startsAt);
  const end = toMillis(drop.endsAt);
  return start !== null && end !== null && start <= nowMs && nowMs < end;
}

function claimOpen(drop: Record<string, unknown>, nowMs: number): boolean {
  if (drop.kind === "fcfs") return drop.status === "open" && liveWindow(drop, nowMs);
  const until = toMillis(drop.claimUntil);
  return drop.status === "drawn" && until !== null && nowMs < until;
}

export async function claimDrop(db: ClosetDb, actor: ClosetActor, dropId: string): Promise<ClaimResult> {
  return db.runTransaction(async (tx) => {
    const drop = (await tx.get(paths.drop(dropId))).data;
    if (!drop) throw new ClosetError("not_found");
    if (!claimOpen(drop, actor.nowMs)) throw new ClosetError("drop_not_live");
    if ((await tx.get(paths.claim(dropId, actor.uid))).data) throw new ClosetError("already_claimed");
    if (drop.kind === "draw") {
      const entry = (await tx.get(paths.entry(dropId, actor.uid))).data;
      if (entry?.won !== true) throw new ClosetError("not_a_winner");
    }
    await assertAccount(tx, actor.uid, actor.nowMs, DROP_RULE);
    const plan = await prepareMint(tx, actor.uid, str(drop.itemDefId), actor.nowMs);
    const wallet = await readWallet(tx, actor.uid);
    const price = num(drop.priceBucks);
    if (!canAfford(wallet, price)) throw new ClosetError("insufficient_bucks");

    const minted = applyMint(tx, plan, { reason: "drop", dropId, nowMs: actor.nowMs });
    const balance =
      price > 0
        ? debit(tx, actor.uid, wallet, price, { reason: "drop", ref: dropId }, `drop_${dropId}`, actor.nowMs).balance
        : wallet.balance;
    tx.set(paths.claim(dropId, actor.uid), {
      copyId: minted.copyId,
      serial: minted.serial,
      claimedAt: ts(actor.nowMs),
    });
    const claimCount = num(drop.claimCount) + 1;
    tx.update(paths.drop(dropId), {
      claimCount,
      soldOut: minted.supply !== null && minted.serial !== null && minted.serial >= minted.supply,
    });
    return { ...minted, balance };
  });
}
