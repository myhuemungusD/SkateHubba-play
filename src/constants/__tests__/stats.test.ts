import { describe, it, expect } from "vitest";

import { MIN_RATED_GAMES, ratedWinRate, totalGames } from "../stats";

describe("totalGames", () => {
  it("sums wins and losses", () => {
    expect(totalGames(3, 4)).toBe(7);
  });

  it.each<[string, number | undefined, number | undefined]>([
    ["both missing", undefined, undefined],
    ["wins missing", undefined, 0],
    ["losses missing", 0, undefined],
  ])("treats %s as zero", (_label, wins, losses) => {
    expect(totalGames(wins, losses)).toBe(0);
  });
});

describe("ratedWinRate", () => {
  // The whole point of the floor: a perfect record over too few games is not
  // a 100% player, and must not render as one.
  it("returns null below the floor even for a perfect record", () => {
    expect(ratedWinRate(MIN_RATED_GAMES - 1, 0)).toBeNull();
  });

  it("returns null below the floor even for a winless record", () => {
    expect(ratedWinRate(0, MIN_RATED_GAMES - 1)).toBeNull();
  });

  it("returns null for a player with no games at all", () => {
    expect(ratedWinRate(undefined, undefined)).toBeNull();
  });

  it("rates a player exactly at the floor", () => {
    expect(ratedWinRate(MIN_RATED_GAMES, 0)).toBe(100);
  });

  it("returns 0 for a rated player who has never won", () => {
    // Distinct from the null case above — this player HAS enough games, so
    // "0%" is a real, earned number rather than missing data.
    expect(ratedWinRate(0, MIN_RATED_GAMES)).toBe(0);
  });

  it("rounds to a whole percent", () => {
    // 1/3 = 33.33…% over 6 games.
    expect(ratedWinRate(2, 4)).toBe(33);
  });

  it("treats a missing losses counter as zero", () => {
    expect(ratedWinRate(6, undefined)).toBe(100);
  });
});
