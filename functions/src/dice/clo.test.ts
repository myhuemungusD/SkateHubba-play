import { describe, it, expect } from "vitest";
import { cloResolve } from "./clo";

describe("cloResolve — auto outcomes", () => {
  it("[4,5,6] auto-wins with rank 1000", () => {
    const r = cloResolve([4, 5, 6]);
    expect(r.outcome).toBe("win");
    expect(r.rank).toBe(1000);
    expect(r.label).toBe("4-5-6");
  });

  it("4-5-6 is order-independent", () => {
    expect(cloResolve([6, 5, 4]).outcome).toBe("win");
    expect(cloResolve([5, 4, 6]).outcome).toBe("win");
    expect(cloResolve([6, 4, 5]).outcome).toBe("win");
  });

  it("[1,2,3] auto-loses with rank -1000", () => {
    const r = cloResolve([1, 2, 3]);
    expect(r.outcome).toBe("loss");
    expect(r.rank).toBe(-1000);
    expect(r.label).toBe("1-2-3 OUT");
  });

  it("1-2-3 is order-independent", () => {
    expect(cloResolve([3, 1, 2]).outcome).toBe("loss");
    expect(cloResolve([2, 3, 1]).outcome).toBe("loss");
  });
});

describe("cloResolve — triples", () => {
  it.each([
    [1, 101],
    [2, 102],
    [3, 103],
    [4, 104],
    [5, 105],
    [6, 106],
  ])("triple %is wins with rank %i", (face, rank) => {
    const r = cloResolve([face, face, face]);
    expect(r.outcome).toBe("win");
    expect(r.rank).toBe(rank);
    expect(r.label).toBe(`TRIPLE ${face}s`);
  });

  it("triples outrank pair-points", () => {
    const triple = cloResolve([2, 2, 2]).rank!;
    const point = cloResolve([6, 6, 5]).rank!;
    expect(triple).toBeGreaterThan(point);
  });
});

describe("cloResolve — pair with odd die (point)", () => {
  it("pair of 1s with a 2 → point 2", () => {
    const r = cloResolve([1, 1, 2]);
    expect(r.outcome).toBe("point");
    expect(r.rank).toBe(2);
    expect(r.label).toBe("POINT 2");
  });

  it("pair of 6s with a 5 → point 5", () => {
    const r = cloResolve([6, 6, 5]);
    expect(r.outcome).toBe("point");
    expect(r.rank).toBe(5);
  });

  it("pair-of-2 with a 1 → point 1 (low point)", () => {
    const r = cloResolve([2, 2, 1]);
    expect(r.outcome).toBe("point");
    expect(r.rank).toBe(1);
  });

  it("pair detected regardless of input order", () => {
    expect(cloResolve([5, 1, 1]).rank).toBe(5);
    expect(cloResolve([1, 5, 1]).rank).toBe(5);
    expect(cloResolve([1, 1, 5]).rank).toBe(5);
  });

  it("higher point outranks lower point", () => {
    expect(cloResolve([1, 1, 6]).rank!).toBeGreaterThan(cloResolve([1, 1, 2]).rank!);
  });
});

describe("cloResolve — re-roll", () => {
  it("three distinct non-4-5-6 / non-1-2-3 dice → re-roll", () => {
    const r = cloResolve([1, 2, 4]);
    expect(r.outcome).toBe("reroll");
    expect(r.rank).toBeNull();
    expect(r.label).toBe("RE-ROLL");
  });

  it("[3,4,5] is NOT 4-5-6 — re-roll", () => {
    expect(cloResolve([3, 4, 5]).outcome).toBe("reroll");
  });

  it("[2,3,5] is just three distinct non-special dice — re-roll", () => {
    expect(cloResolve([2, 3, 5]).outcome).toBe("reroll");
  });
});

describe("cloResolve — full ranking order", () => {
  it("4-5-6 > triple > point > re-roll-null and < auto-win triples", () => {
    const win = cloResolve([4, 5, 6]).rank!;
    const tripleTop = cloResolve([6, 6, 6]).rank!;
    const pointTop = cloResolve([5, 5, 6]).rank!;
    expect(win).toBeGreaterThan(tripleTop);
    expect(tripleTop).toBeGreaterThan(pointTop);
  });
});
