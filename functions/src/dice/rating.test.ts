import { describe, expect, it } from "vitest";
import { expectedScore, repOf, repSwing, REP_FLOOR, REP_START } from "./rating.js";

describe("Rep (Elo, K = 32)", () => {
  it("even players swing 16", () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5);
    expect(repSwing(1000, 1000)).toEqual({ winner: 16, loser: -16 });
  });

  it("an upset moves more than a favourite winning", () => {
    const upset = repSwing(900, 1300);
    const expected = repSwing(1300, 900);
    expect(upset.winner).toBeGreaterThan(expected.winner);
    expect(upset.winner).toBe(29);
    expect(expected.winner).toBe(3);
  });

  it("the winner always gains at least 1 and nobody drops under the floor", () => {
    expect(repSwing(3000, 100).winner).toBe(1);
    expect(repSwing(REP_FLOOR + 4, REP_FLOOR + 4).loser).toBe(-4);
    expect(repSwing(REP_FLOOR, REP_FLOOR).loser).toBe(0);
  });

  it("reads a missing or broken rating as the starting Rep", () => {
    expect(repOf(undefined)).toBe(REP_START);
    expect(repOf(Number.NaN)).toBe(REP_START);
    expect(repOf(1234)).toBe(1234);
  });
});
