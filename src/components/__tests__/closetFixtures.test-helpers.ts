/** Shared closet-item fixture for the ClosetGrid / ClosetShowcase tests. */
import type { LockerItem } from "../../services/locker";

export function closetItem(overrides?: Partial<LockerItem>): LockerItem {
  return {
    id: "d1",
    type: "deck",
    brand: "Test Brand",
    name: "Test Deck",
    imageUrl: null,
    rarity: "common",
    acquiredAt: new Date(),
    provenanceReason: null,
    equipped: false,
    itemDefId: null as string | null,
    ...overrides,
  } as LockerItem;
}
