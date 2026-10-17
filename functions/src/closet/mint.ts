/**
 * Minting. Split into a read phase and a write phase so a caller can do all
 * of its transaction reads (drop, wallet, claim) before any write.
 *
 * Serials are handed out in order inside the transaction: #1 is the first
 * claim. `edition.minted` only ever goes up and `soldOut` never flips back,
 * so a sold-out run cannot be reprinted.
 */
import { TRADE_ITEM_COOLDOWN_DAYS } from "./economy.js";
import { ClosetError, DAY_MS, isReleased, parseDef, paths, ts, type CatalogDef } from "./model.js";
import type { ClosetTx } from "./store.js";

export interface MintPlan {
  uid: string;
  defId: string;
  def: CatalogDef;
  serial: number | null;
  supply: number | null;
  copyId: string;
}

export interface MintResult {
  copyId: string;
  serial: number | null;
  supply: number | null;
}

export function isSerialized(def: CatalogDef): boolean {
  return def.edition.kind !== "open";
}

function supplyOf(def: CatalogDef): number | null {
  if (def.edition.kind === "one_of_one") return 1;
  if (def.edition.kind === "limited") return def.edition.supply;
  return null;
}

/** Reads only. Throws when the item cannot be minted for `uid` right now. */
export async function prepareMint(tx: ClosetTx, uid: string, defId: string, nowMs: number): Promise<MintPlan> {
  const def = parseDef((await tx.get(paths.def(defId))).data);
  if (!isReleased(def, nowMs)) throw new ClosetError("not_released");
  if (!isSerialized(def)) {
    const owned = await tx.get(paths.copy(uid, defId));
    if (owned.data) throw new ClosetError("already_owned");
    return { uid, defId, def, serial: null, supply: null, copyId: defId };
  }
  const supply = supplyOf(def);
  if (supply === null || supply < 1 || def.edition.soldOut || def.edition.minted >= supply) {
    throw new ClosetError("sold_out");
  }
  const serial = def.edition.minted + 1;
  return { uid, defId, def, serial, supply, copyId: `${defId}_${serial}` };
}

export interface MintMeta {
  reason: string;
  dropId: string | null;
  nowMs: number;
}

/** Writes only: catalog counter, serial ledger row, locker copy. */
export function applyMint(tx: ClosetTx, plan: MintPlan, meta: MintMeta): MintResult {
  const at = ts(meta.nowMs);
  const { def, serial, supply } = plan;
  if (serial !== null && supply !== null) {
    tx.update(paths.def(plan.defId), { "edition.minted": serial, "edition.soldOut": serial >= supply });
    tx.set(paths.serial(plan.defId, serial), {
      itemDefId: plan.defId,
      serial,
      ownerUid: plan.uid,
      mintedAt: at,
      history: [{ uid: plan.uid, at, reason: meta.reason }],
    });
  }
  tx.set(paths.copy(plan.uid, plan.copyId), {
    itemDefId: plan.defId,
    type: def.type,
    slot: def.slot,
    brand: def.licensed.brand ?? "SkateHubba",
    name: def.name,
    imageUrl: def.artUrl,
    rarity: def.rarity,
    serial,
    supplyAtMint: supply,
    equipped: false,
    tradableAfter: ts(meta.nowMs + TRADE_ITEM_COOLDOWN_DAYS * DAY_MS),
    acquiredAt: at,
    provenance: { reason: meta.reason, dropId: meta.dropId, prevOwners: [], mintedAt: at },
  });
  return { copyId: plan.copyId, serial, supply };
}
