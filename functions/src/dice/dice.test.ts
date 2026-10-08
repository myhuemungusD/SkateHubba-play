import { describe, it, expect } from "vitest";
import { rollDie, rollN } from "./dice";

describe("rollDie", () => {
  it("returns an integer in 1..6", () => {
    const v = rollDie();
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(1);
    expect(v).toBeLessThanOrEqual(6);
  });

  it("only ever produces values 1..6 across many rolls", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(rollDie());
    for (const v of seen) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("rollN", () => {
  it("returns an empty array when n is 0", () => {
    expect(rollN(0)).toEqual([]);
  });

  it("returns an array of length n", () => {
    expect(rollN(2)).toHaveLength(2);
    expect(rollN(6)).toHaveLength(6);
  });

  it("every value is in 1..6", () => {
    const roll = rollN(6);
    for (const v of roll) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });
});
