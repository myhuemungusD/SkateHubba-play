import { describe, expect, it } from "vitest";
import { formatRecord } from "../stats";

describe("formatRecord", () => {
  it("shows wins over games with no letters", () => {
    expect(formatRecord(2, 4)).toEqual({ text: "2 / 4", label: "2 wins out of 4 games" });
  });

  it("uses singular words for one", () => {
    expect(formatRecord(1, 1).label).toBe("1 win out of 1 game");
    expect(formatRecord(0, 1)).toEqual({ text: "0 / 1", label: "0 wins out of 1 game" });
  });

  it.each([
    ["undefined", undefined, undefined],
    ["NaN", Number.NaN, Number.NaN],
    ["negative", -2, -1],
  ])("treats %s counters as zero", (_l, w, g) => {
    expect(formatRecord(w, g)).toEqual({ text: "0 / 0", label: "0 wins out of 0 games" });
  });

  it("never shows more wins than games and drops fractions", () => {
    expect(formatRecord(5, 3).text).toBe("3 / 3");
    expect(formatRecord(2.7, 4.2).text).toBe("2 / 4");
  });
});
