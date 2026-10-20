import { describe, expect, it } from "vitest";
import { appendCapped, currentTurnOf, matchFromData, namesFrom, stateFields } from "./docs.js";
import { freshMatch } from "./engine.js";

const LEGACY = {
  v: 1,
  game: "clo",
  playerUids: ["a", "b"],
  player1Uid: "a",
  player2Uid: "b",
  player1Username: "jason",
  player2Username: "remy",
  status: "active",
  currentTurn: "b",
  round: 4,
  roundsWon: { a: 2, b: 1 },
  results: { a: { dice: [2, 2, 5], outcome: "point", label: "POINT 5", rank: 5 }, junk: { dice: "x" } },
  rollCount: 9,
  winner: null,
  endReason: null,
};

describe("matchFromData", () => {
  it("loads a v1 match as a C-Lo race where each round already won is worth 1 point", () => {
    const m = matchFromData(LEGACY);
    expect(m).toMatchObject({
      mode: "clo",
      target: 5,
      status: "active",
      current: 1,
      round: 4,
      scores: { a: 2, b: 1 },
      roundsWon: { a: 2, b: 1 },
      rolls: { a: [2, 2, 5] },
      point: null,
      accepted: false,
      endReason: null,
    });
    expect(m?.ten).toEqual({ turnScore: 0, kept: [], rolled: [] });
  });

  it("reads v2 fields", () => {
    const m = matchFromData({
      ...LEGACY,
      game: "ten",
      target: 10000,
      scores: { a: 3000, b: 50 },
      point: 8,
      ten: { turnScore: 150, kept: [1, 5], rolled: [2, 3, 9] },
      turns: { a: 3, b: 2 },
      accepted: true,
      endReason: "target",
      currentTurn: "nobody",
      round: "x",
    });
    expect(m).toMatchObject({
      mode: "ten",
      target: 10000,
      scores: { a: 3000, b: 50 },
      point: 8,
      turns: { a: 3, b: 2 },
      accepted: true,
      endReason: "target",
      current: 0,
      round: 1,
    });
    expect(m?.ten).toEqual({ turnScore: 150, kept: [1, 5], rolled: [] });
  });

  it("falls back on unknown modes, targets and points", () => {
    const m = matchFromData({ ...LEGACY, game: "poker", target: 77, point: 7, endReason: "weird" });
    expect(m).toMatchObject({ mode: "clo", target: 5, point: null, endReason: null });
  });

  it("rejects docs that are not matches", () => {
    expect(matchFromData({ ...LEGACY, player1Uid: "" })).toBeNull();
    expect(matchFromData({ ...LEGACY, player2Uid: 4 })).toBeNull();
    expect(matchFromData({ ...LEGACY, status: "won" })).toBeNull();
    expect(matchFromData({ ...LEGACY, status: 3 })).toBeNull();
  });
});

describe("stateFields and helpers", () => {
  it("writes v2 fields and only settled hands as results", () => {
    const m = { ...freshMatch(["a", "b"], "clo", 9), status: "active" as const, rolls: { a: [2, 2, 5], b: [1, 2, 4] } };
    const fields = stateFields(m, 42);
    expect(fields).toMatchObject({ v: 2, game: "clo", target: 9, currentTurn: "a", updatedAt: 42, point: null });
    expect(fields.results).toEqual({ a: { dice: [2, 2, 5], outcome: "point", rank: 5 } });
    expect(currentTurnOf({ ...m, status: "complete" })).toBeNull();
    expect(currentTurnOf({ ...m, current: 7 })).toBeNull();
  });

  it("names both seats and caps lists", () => {
    const m = freshMatch(["a", "b"], "clo", 5);
    expect(namesFrom(LEGACY, m)).toEqual({ a: "jason", b: "remy" });
    expect(namesFrom({}, m)).toEqual({});
    expect(appendCapped([1, 2], { x: 3 }, 2)).toEqual([2, { x: 3 }]);
    expect(appendCapped(undefined, { x: 1 }, 2)).toEqual([{ x: 1 }]);
  });
});
