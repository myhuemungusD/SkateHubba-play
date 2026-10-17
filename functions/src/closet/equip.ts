/**
 * Equip / unequip a closet item on the avatar. One item per slot: equipping
 * clears whatever else in that slot is equipped, in the same transaction.
 */
import { asSlot, ClosetError, paths, str } from "./model.js";
import type { ClosetDb } from "./store.js";

export interface EquipResult {
  copyId: string;
  equipped: boolean;
  unequipped: string[];
}

export async function equipItem(db: ClosetDb, uid: string, copyId: string, equip: boolean): Promise<EquipResult> {
  return db.runTransaction(async (tx) => {
    const copy = (await tx.get(paths.copy(uid, copyId))).data;
    if (!copy) throw new ClosetError("not_found");
    if (str(copy.lockedByTrade)) throw new ClosetError("item_locked");
    if (!equip) {
      tx.update(paths.copy(uid, copyId), { equipped: false });
      return { copyId, equipped: false, unequipped: [] };
    }
    const slot = asSlot(copy.slot);
    if (!slot) throw new ClosetError("not_equippable");
    const worn = await tx.query({
      collection: paths.locker(uid),
      filters: [
        { field: "equipped", op: "==", value: true },
        { field: "slot", op: "==", value: slot },
      ],
    });
    const unequipped = worn.map((row) => row.id).filter((id) => id !== copyId);
    for (const id of unequipped) tx.update(paths.copy(uid, id), { equipped: false });
    tx.update(paths.copy(uid, copyId), { equipped: true });
    return { copyId, equipped: true, unequipped };
  });
}
