/**
 * Daily shop: open-edition items at a fixed, known price. Never a random
 * outcome. One copy per skater ("you already own this").
 */
import { applyMint, prepareMint } from "./mint.js";
import { ClosetError, paths, type ClosetActor } from "./model.js";
import type { ClosetDb } from "./store.js";
import { debit, readWallet } from "./wallet.js";

export interface PurchaseResult {
  copyId: string;
  price: number;
  balance: number;
}

export async function buyShopItem(db: ClosetDb, actor: ClosetActor, itemDefId: string): Promise<PurchaseResult> {
  return db.runTransaction(async (tx) => {
    if (!(await tx.get(paths.user(actor.uid))).data) throw new ClosetError("not_found");
    if ((await tx.get(paths.ban(actor.uid))).data) throw new ClosetError("banned");
    const plan = await prepareMint(tx, actor.uid, itemDefId, actor.nowMs);
    const price = plan.def.priceBucks;
    if (plan.def.source !== "shop" || plan.def.edition.kind !== "open" || price === null || price <= 0) {
      throw new ClosetError("not_for_sale");
    }
    const wallet = await readWallet(tx, actor.uid);
    const txId = `shop_${db.newId("ledger")}`;
    const next = debit(tx, actor.uid, wallet, price, { reason: "shop", ref: itemDefId }, txId, actor.nowMs);
    const minted = applyMint(tx, plan, { reason: "shop", dropId: null, nowMs: actor.nowMs });
    return { copyId: minted.copyId, price, balance: next.balance };
  });
}
