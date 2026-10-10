import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  BRONZE_ACHIEVEMENTS,
  achievementFamilies,
  callXp,
  levelForXp,
  pairMultiplier,
  playXpBeforeScale,
  scaleXp,
  xpProgress,
  xpToReach,
} from "../xp";

describe("xp curve", () => {
  it("pins level 2, level 10, and level 50", () => {
    expect(xpToReach(2)).toBe(24);
    expect(xpToReach(10)).toBe(1944);
    expect(xpToReach(50)).toBe(57624);
    expect(levelForXp(23)).toBe(1);
    expect(levelForXp(24)).toBe(2);
    expect(levelForXp(1944)).toBe(10);
    expect(levelForXp(57624)).toBe(50);
    expect(levelForXp(90000)).toBe(50);
  });

  it("labels the next level total and fills the bar at level 50", () => {
    expect(xpProgress(140).label).toBe("140 / 216 XP");
    expect(xpProgress(140).level).toBe(3);
    expect(xpProgress(57624).label).toBe("Level 50");
    expect(xpProgress(undefined).level).toBe(1);
  });
});

describe("xp awards", () => {
  it("is four rules, with an empty forfeit and a young account paying nothing", () => {
    expect(
      playXpBeforeScale({
        status: "complete",
        emptyForfeit: false,
        accountsOldEnough: true,
        isWinner: true,
        lands: 4,
      }),
    ).toBe(140);
    expect(
      playXpBeforeScale({
        status: "forfeit",
        emptyForfeit: false,
        accountsOldEnough: true,
        isWinner: true,
        lands: 1,
      }),
    ).toBe(60);
    expect(
      playXpBeforeScale({
        status: "forfeit",
        emptyForfeit: true,
        accountsOldEnough: true,
        isWinner: true,
        lands: 3,
      }),
    ).toBe(0);
    expect(
      playXpBeforeScale({
        status: "complete",
        emptyForfeit: false,
        accountsOldEnough: false,
        isWinner: true,
        lands: 3,
      }),
    ).toBe(0);
    expect(scaleXp(110, pairMultiplier(1))).toBe(55);
    expect(pairMultiplier(3)).toBe(0);
    expect(callXp(2, false)).toBe(20);
    expect(callXp(2, true)).toBe(0);
  });
});

describe("achievements", () => {
  it("is 36 tiles in 12 families, with 12 bronzes on the ribbon", () => {
    expect(ACHIEVEMENTS).toHaveLength(36);
    expect(BRONZE_ACHIEVEMENTS).toHaveLength(12);
    expect(achievementFamilies()).toHaveLength(12);
    expect(new Set(ACHIEVEMENTS.map((item) => item.id)).size).toBe(36);
    expect(ACHIEVEMENTS.some((item) => item.id === "century")).toBe(false);
  });
});
