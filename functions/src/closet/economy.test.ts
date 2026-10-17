import { describe, expect, it } from "vitest";
import { isImbalanced, priceFits, rarityWeight, PRICE_BY_RARITY, DAILY_EARN_CAP, TRADE_FEE } from "./economy.js";
import type { Rarity } from "./model.js";

describe("economy", () => {
  it("matches the plan's numbers", () => {
    expect(PRICE_BY_RARITY).toEqual({ common: 50, uncommon: 150, rare: 400 });
    expect(DAILY_EARN_CAP).toBe(200);
    expect(TRADE_FEE).toBe(10);
  });

  it("enforces the price curve", () => {
    expect(priceFits("common", null)).toBe(true);
    expect(priceFits("common", 50)).toBe(true);
    expect(priceFits("common", 51)).toBe(false);
    expect(priceFits("rare", 400)).toBe(true);
    expect(priceFits("limited", 799)).toBe(false);
    expect(priceFits("limited", 800)).toBe(true);
    expect(priceFits("limited", 2000)).toBe(true);
    expect(priceFits("limited", 2001)).toBe(false);
    expect(priceFits("grail", 0)).toBe(true);
    expect(priceFits("grail", 2001)).toBe(false);
    expect(priceFits("uncommon", -150)).toBe(false);
    expect(priceFits("uncommon", 1.5)).toBe(false);
    expect(() => priceFits("bogus" as Rarity, 1)).toThrow("unknown rarity");
  });

  it("flags lopsided trades in either direction", () => {
    expect(rarityWeight(["common", "grail"])).toBe(82);
    expect(isImbalanced(["grail", "grail"], ["common"])).toBe(true);
    expect(isImbalanced(["common"], ["limited"])).toBe(true);
    expect(isImbalanced(["rare"], ["uncommon", "uncommon", "uncommon"])).toBe(false);
  });
});
