/**
 * Closet shop service — buy open-edition items with Hubba Bucks.
 */
import { callCloset } from "./closet.callable";
import { parseFirebaseError } from "../utils/helpers";
import { logger } from "./logger";
import { trackEvent } from "./analytics";

/**
 * Buy an item from the shop with Hubba Bucks.
 * Throws on failure (insufficient bucks, already owned, etc.).
 */
export async function buyShopItem(itemDefId: string): Promise<{ copyId: string }> {
  try {
    const data = await callCloset<{ itemDefId: string }, { copyId: string }>("buyShopItem", { itemDefId });
    trackEvent("closet_shop_purchase", { itemDefId });
    return data;
  } catch (err) {
    logger.warn("buy_shop_item_failed", { itemDefId, error: parseFirebaseError(err) });
    throw err;
  }
}

/**
 * Equip or unequip a closet item on the avatar.
 */
export async function equipItem(copyId: string, equip: boolean): Promise<void> {
  try {
    await callCloset<{ copyId: string; equip: boolean }, void>("equipItem", { copyId, equip });
    trackEvent("closet_item_equipped", { copyId, equip });
  } catch (err) {
    logger.warn("equip_item_failed", { copyId, error: parseFirebaseError(err) });
    throw err;
  }
}
