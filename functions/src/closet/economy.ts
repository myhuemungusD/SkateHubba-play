/**
 * Economy numbers from the closet plan (§5, §6, §11). One place so the
 * simulation, the server and the client mirror (`src/services/closet.*`)
 * can be compared line by line.
 */
import type { Rarity } from "./model.js";

/** Fixed shop prices. Limited is a range; Grail is draw-only (price may be 0). */
export const PRICE_BY_RARITY: Readonly<Record<"common" | "uncommon" | "rare", number>> = {
  common: 50,
  uncommon: 150,
  rare: 400,
};
export const LIMITED_PRICE_MIN = 800;
export const LIMITED_PRICE_MAX = 2000;

/** Daily hard cap on earned Bucks, across every source. */
export const DAILY_EARN_CAP = 200;

export type EarnEvent =
  "game_finished" | "game_won" | "spot_checkin" | "weekly_challenge" | "whats_that_trick" | "level_up";

export const EARN_EVENTS: readonly EarnEvent[] = [
  "game_finished",
  "game_won",
  "spot_checkin",
  "weekly_challenge",
  "whats_that_trick",
  "level_up",
];

/** Base Bucks per event. Weekly challenge and level up take an amount / tier. */
export const EARN_BASE: Readonly<Record<EarnEvent, number>> = {
  game_finished: 10,
  game_won: 15,
  spot_checkin: 20,
  weekly_challenge: 0,
  whats_that_trick: 1,
  level_up: 25,
};

/** Per-event daily count caps (absent = no per-event cap beyond the daily total). */
export const EARN_DAILY_COUNT: Readonly<Partial<Record<EarnEvent, number>>> = {
  spot_checkin: 3,
  whats_that_trick: 20,
};

/** Paid games per opponent per UTC day (same as the XP repeat-opponent rule). */
export const PAID_GAMES_PER_OPPONENT = 3;
export const WEEKLY_CHALLENGE_MIN = 50;
export const WEEKLY_CHALLENGE_MAX = 150;
export const LEVEL_TIER_MAX = 50;

/** Drop and draw eligibility. */
export const DROP_MIN_ACCOUNT_DAYS = 7;
export const DROP_MIN_GAMES = 3;

/** Trading. */
export const TRADE_FEE = 10;
export const TRADE_MAX_ITEMS = 4;
export const TRADE_OFFERS_PER_DAY = 10;
export const TRADES_COMPLETED_PER_DAY = 3;
export const TRADE_ITEM_COOLDOWN_DAYS = 7;
export const TRADE_HOLD_DAYS = 3;
export const TRADE_MIN_ACCOUNT_DAYS = 14;
export const TRADE_MIN_GAMES = 5;
export const TRADE_OFFER_TTL_DAYS = 7;
export const PREV_OWNERS_CAP = 10;
export const SERIAL_HISTORY_CAP = 20;

/** Rarity weight for the imbalance warning: each tier is worth ~3 of the one below. */
export const RARITY_WEIGHT: Readonly<Record<Rarity, number>> = {
  common: 1,
  uncommon: 3,
  rare: 9,
  limited: 27,
  grail: 81,
};
/** Warn when one side carries more than this multiple of the other side's weight. */
export const IMBALANCE_RATIO = 3;

export function rarityWeight(rarities: readonly Rarity[]): number {
  return rarities.reduce((sum, r) => sum + RARITY_WEIGHT[r], 0);
}

/** True when the giver hands over far more rarity weight than they receive. */
export function isImbalanced(give: readonly Rarity[], get: readonly Rarity[]): boolean {
  const g = rarityWeight(give);
  const r = rarityWeight(get);
  return g > r * IMBALANCE_RATIO || r > g * IMBALANCE_RATIO;
}

/** Validate a catalog price against the curve. `null` price means "not for sale". */
export function priceFits(rarity: Rarity, price: number | null): boolean {
  if (price === null) return true;
  if (!Number.isInteger(price) || price < 0) return false;
  switch (rarity) {
    case "common":
    case "uncommon":
    case "rare":
      return price === PRICE_BY_RARITY[rarity];
    case "limited":
      return price >= LIMITED_PRICE_MIN && price <= LIMITED_PRICE_MAX;
    case "grail":
      return price <= LIMITED_PRICE_MAX;
    default: {
      const never: never = rarity;
      return never;
    }
  }
}
