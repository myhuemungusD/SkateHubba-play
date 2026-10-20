import { describe, expect, it } from "vitest";
import { cloHandPoints, crapsHandPoints } from "./points.js";
import { defaultTarget, isAllowedTarget, isDiceMode, MODE_RULES } from "./modes.js";

describe("hand points", () => {
  it("C-Lo: 4-5-6 = 3, trips = 2, point = 1", () => {
    expect(cloHandPoints([6, 5, 4])).toBe(3);
    expect(cloHandPoints([2, 2, 2])).toBe(2);
    expect(cloHandPoints([3, 3, 6])).toBe(1);
  });

  it("Craps: natural = 1, point made = 2, hard 4/10 = 3, a miss = 0", () => {
    expect(crapsHandPoints(true, true, null)).toBe(1);
    expect(crapsHandPoints(true, false, 6)).toBe(2);
    expect(crapsHandPoints(true, false, 4)).toBe(3);
    expect(crapsHandPoints(true, false, 10)).toBe(3);
    expect(crapsHandPoints(false, false, 6)).toBe(0);
  });
});

describe("modes", () => {
  it("knows the four games and their race-to targets", () => {
    expect(isDiceMode("ten")).toBe(true);
    expect(isDiceMode("poker")).toBe(false);
    expect(isDiceMode(3)).toBe(false);
    expect(defaultTarget("clo")).toBe(5);
    expect(defaultTarget("ten")).toBe(5000);
    expect(isAllowedTarget("ten", 10000)).toBe(true);
    expect(isAllowedTarget("ten", 9)).toBe(false);
    expect(isAllowedTarget("craps", "5")).toBe(false);
    expect(MODE_RULES.craps.alternating).toBe(true);
  });
});
