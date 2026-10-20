import { describe, it, expect } from "vitest";
import { ten10kScoreCombo } from "./farkle.js";

describe("ten10kScoreCombo — empty and trivial inputs", () => {
  it("empty array returns score 0 with empty used", () => {
    expect(ten10kScoreCombo([])).toEqual({ score: 0, used: [] });
  });

  it("a lone 1 scores 100", () => {
    expect(ten10kScoreCombo([1]).score).toBe(100);
  });

  it("a lone 5 scores 50", () => {
    expect(ten10kScoreCombo([5]).score).toBe(50);
  });

  it.each([2, 3, 4, 6])("a lone %i scores 0 (Farkle die)", (face) => {
    expect(ten10kScoreCombo([face]).score).toBe(0);
  });
});

describe("ten10kScoreCombo — lone 1s and 5s", () => {
  it("two 1s score 200", () => {
    expect(ten10kScoreCombo([1, 1]).score).toBe(200);
  });

  it("two 5s score 100", () => {
    expect(ten10kScoreCombo([5, 5]).score).toBe(100);
  });

  it("one 1 and one 5 score 150", () => {
    expect(ten10kScoreCombo([1, 5]).score).toBe(150);
  });
});

describe("ten10kScoreCombo — triples", () => {
  it.each([
    [1, 1000],
    [2, 200],
    [3, 300],
    [4, 400],
    [5, 500],
    [6, 600],
  ])("triple %is scores %i", (face, expected) => {
    expect(ten10kScoreCombo([face, face, face]).score).toBe(expected);
  });
});

describe("ten10kScoreCombo — multi-of-a-kind", () => {
  it("four 1s score 2000 (triple base * 2)", () => {
    expect(ten10kScoreCombo([1, 1, 1, 1]).score).toBe(2000);
  });

  it("four 3s score 600 (300 * 2)", () => {
    expect(ten10kScoreCombo([3, 3, 3, 3]).score).toBe(600);
  });

  it("five 1s score 4000 (1000 * 4)", () => {
    expect(ten10kScoreCombo([1, 1, 1, 1, 1]).score).toBe(4000);
  });

  it("five 4s score 1600 (400 * 4)", () => {
    expect(ten10kScoreCombo([4, 4, 4, 4, 4]).score).toBe(1600);
  });

  it("six 1s score 8000 (1000 * 8)", () => {
    expect(ten10kScoreCombo([1, 1, 1, 1, 1, 1]).score).toBe(8000);
  });

  it("six 6s score 4800 (600 * 8)", () => {
    expect(ten10kScoreCombo([6, 6, 6, 6, 6, 6]).score).toBe(4800);
  });

  it("six 2s score 1600 (200 * 8)", () => {
    expect(ten10kScoreCombo([2, 2, 2, 2, 2, 2]).score).toBe(1600);
  });
});

describe("ten10kScoreCombo — straight 1-2-3-4-5-6", () => {
  it("a 6-dice straight scores 1500", () => {
    expect(ten10kScoreCombo([1, 2, 3, 4, 5, 6]).score).toBe(1500);
  });

  it("a straight is order-independent", () => {
    expect(ten10kScoreCombo([6, 5, 4, 3, 2, 1]).score).toBe(1500);
    expect(ten10kScoreCombo([3, 1, 5, 2, 6, 4]).score).toBe(1500);
  });

  it("five-dice run missing the 6 is NOT a straight (only the 1 and 5 score)", () => {
    expect(ten10kScoreCombo([1, 2, 3, 4, 5]).score).toBe(150);
  });
});

describe("ten10kScoreCombo — three pairs", () => {
  it("three pairs (2,2,3,3,5,5) score 1000", () => {
    expect(ten10kScoreCombo([2, 2, 3, 3, 5, 5]).score).toBe(1000);
  });

  it("three pairs including 1s and 5s still scores 1000 (pairs consume the dice)", () => {
    expect(ten10kScoreCombo([1, 1, 2, 2, 3, 3]).score).toBe(1000);
  });

  it("only two pairs does NOT trigger the three-pair bonus", () => {
    expect(ten10kScoreCombo([2, 2, 3, 3]).score).toBe(0);
  });
});

describe("ten10kScoreCombo — mixed combinations", () => {
  it("two 1s plus one 5 score 250", () => {
    expect(ten10kScoreCombo([1, 1, 5]).score).toBe(250);
  });

  it("triple 1s plus two 5s score 1100", () => {
    expect(ten10kScoreCombo([1, 1, 1, 5, 5]).score).toBe(1100);
  });

  it("triple 3s plus a 5 scores 350", () => {
    expect(ten10kScoreCombo([3, 3, 3, 5]).score).toBe(350);
  });

  it("four 4s plus a 5 score 850", () => {
    expect(ten10kScoreCombo([4, 4, 4, 4, 5]).score).toBe(850);
  });

  it("triple 1s plus triple 2s score 1200", () => {
    expect(ten10kScoreCombo([1, 1, 1, 2, 2, 2]).score).toBe(1200);
  });
});

describe("ten10kScoreCombo — Farkles (non-scoring rolls)", () => {
  it("[2,3,4] is a Farkle (score 0)", () => {
    expect(ten10kScoreCombo([2, 3, 4]).score).toBe(0);
  });

  it("[2,3,4,6] is a Farkle (score 0)", () => {
    expect(ten10kScoreCombo([2, 3, 4, 6]).score).toBe(0);
  });

  it("[2,3,4,4,6] (only one pair) is still a Farkle", () => {
    expect(ten10kScoreCombo([2, 3, 4, 4, 6]).score).toBe(0);
  });
});

describe("ten10kScoreCombo — used[] marks contributing dice", () => {
  it("lone 1 marks only that die used", () => {
    const { used } = ten10kScoreCombo([1, 2, 3]);
    expect(used).toEqual([true, false, false]);
  });

  it("triple marks exactly the triple dice used", () => {
    const { used } = ten10kScoreCombo([3, 3, 3, 2, 4]);
    expect(used).toEqual([true, true, true, false, false]);
  });

  it("a straight marks all six dice used", () => {
    const { used } = ten10kScoreCombo([3, 1, 5, 2, 6, 4]);
    expect(used).toEqual([true, true, true, true, true, true]);
  });

  it("lone 1 and lone 5 in [1,2,5] marks first and last", () => {
    const { used } = ten10kScoreCombo([1, 2, 5]);
    expect(used).toEqual([true, false, true]);
  });

  it("a Farkle marks no dice used", () => {
    const { used } = ten10kScoreCombo([2, 3, 4]);
    expect(used).toEqual([false, false, false]);
  });
});
