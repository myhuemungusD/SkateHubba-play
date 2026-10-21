import { describe, it, expect } from "vitest";
import { crapsResolve } from "./craps.js";

describe("crapsResolve — comeout phase", () => {
  it("sum of 7 wins", () => {
    const r = crapsResolve([3, 4], "comeout", null);
    expect(r.outcome).toBe("win");
    expect(r.sum).toBe(7);
    expect(r.label).toBe("7 · WIN");
  });

  it("sum of 11 wins", () => {
    const r = crapsResolve([5, 6], "comeout", null);
    expect(r.outcome).toBe("win");
    expect(r.sum).toBe(11);
    expect(r.label).toBe("11 · WIN");
  });

  it("sum of 2 craps out", () => {
    const r = crapsResolve([1, 1], "comeout", null);
    expect(r.outcome).toBe("loss");
    expect(r.label).toBe("CRAPS");
  });

  it("sum of 3 craps out", () => {
    const r = crapsResolve([1, 2], "comeout", null);
    expect(r.outcome).toBe("loss");
    expect(r.label).toBe("CRAPS");
  });

  it("sum of 12 craps out", () => {
    const r = crapsResolve([6, 6], "comeout", null);
    expect(r.outcome).toBe("loss");
    expect(r.label).toBe("CRAPS");
  });

  it.each([
    [[1, 3], 4],
    [[2, 3], 5],
    [[2, 4], 6],
    [[3, 5], 8],
    [[4, 5], 9],
    [[4, 6], 10],
  ])("sum %s establishes point %i", (roll, expected) => {
    const r = crapsResolve(roll, "comeout", null);
    expect(r.outcome).toBe("point");
    if (r.outcome === "point") {
      expect(r.point).toBe(expected);
      expect(r.sum).toBe(expected);
      expect(r.label).toBe(`POINT ${expected}`);
    }
  });
});

describe("crapsResolve — point phase", () => {
  it.each([4, 5, 6, 8, 9, 10])("rolling the point %i wins (POINT MADE)", (point) => {
    const a = Math.min(6, point - 1);
    const b = point - a;
    const r = crapsResolve([a, b], "point", point);
    expect(r.outcome).toBe("win");
    expect(r.label).toBe("POINT MADE");
  });

  it("rolling a 7 in point phase loses (SEVEN OUT)", () => {
    const r = crapsResolve([3, 4], "point", 8);
    expect(r.outcome).toBe("loss");
    expect(r.label).toBe("SEVEN OUT");
  });

  it("rolling anything else in point phase continues", () => {
    const r = crapsResolve([2, 3], "point", 8);
    expect(r.outcome).toBe("continue");
    expect(r.sum).toBe(5);
  });

  it("an 11 in point phase does NOT auto-win — continues", () => {
    const r = crapsResolve([5, 6], "point", 8);
    expect(r.outcome).toBe("continue");
  });

  it("a 2 in point phase does NOT auto-lose — continues", () => {
    const r = crapsResolve([1, 1], "point", 8);
    expect(r.outcome).toBe("continue");
  });

  it("a 12 in point phase does NOT auto-lose — continues", () => {
    const r = crapsResolve([6, 6], "point", 8);
    expect(r.outcome).toBe("continue");
  });
});
