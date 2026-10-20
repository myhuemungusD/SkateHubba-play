import { describe, expect, it } from "vitest";
import { freshMatch, type DiceMatch } from "./engine.js";
import { applyCloRoll, applyCrapsRoll, applyTenBank, applyTenRoll, cloLabel, tenRollCount } from "./play.js";

function live(mode: DiceMatch["mode"], target: number, overrides: Partial<DiceMatch> = {}): DiceMatch {
  return { ...freshMatch(["a", "b"], mode, target), status: "active", accepted: true, ...overrides };
}

describe("cloLabel", () => {
  it("names every hand in plain words", () => {
    expect(cloLabel([4, 6, 5])).toBe("4-5-6");
    expect(cloLabel([3, 3, 3])).toBe("Trips 3s");
    expect(cloLabel([2, 2, 5])).toBe("Point 5");
    expect(cloLabel([1, 3, 2])).toBe("1-2-3");
    expect(cloLabel([1, 2, 4])).toBe("No point");
  });
});

describe("C-Lo", () => {
  it("no point keeps the turn and scores nothing", () => {
    const r = applyCloRoll(live("clo", 5), "a", [1, 2, 4]);
    expect(r.effect).toEqual({ type: "again" });
    expect(r.state.current).toBe(0);
    expect(r.state.rollCount).toBe(1);
    expect(r.record).toBeNull();
  });

  it("a settled hand passes the roll; 4-5-6 waits for the other player", () => {
    const r = applyCloRoll(live("clo", 5), "a", [4, 5, 6]);
    expect(r.effect).toEqual({ type: "advance", nextUid: "b" });
    expect(r.callout).toBe("Clean");
    expect(r.state.scores).toEqual({ a: 0, b: 0 });
  });

  it("best hand takes the round and scores by strength: 4-5-6 = 3, trips = 2, point = 1", () => {
    const cases: Array<[number[], number[], string, number]> = [
      [[4, 5, 6], [6, 6, 5], "a", 3],
      [[2, 2, 2], [6, 6, 5], "a", 2],
      [[3, 3, 4], [1, 1, 6], "b", 1],
      [[1, 2, 3], [1, 1, 2], "b", 1],
    ];
    for (const [aDice, bDice, winner, points] of cases) {
      const first = applyCloRoll(live("clo", 9), "a", aDice);
      const second = applyCloRoll(first.state, "b", bDice);
      expect(second.effect).toMatchObject({ type: "round", winnerUid: winner, points });
      expect(second.state.scores[winner]).toBe(points);
      expect(second.state.roundsWon[winner]).toBe(1);
      expect(second.record).toMatchObject({ round: 1, winner, points });
      expect(Object.keys(second.record?.hands ?? {})).toEqual(["a", "b"]);
      expect(second.state.round).toBe(2);
      expect(second.state.current).toBe(1);
      expect(second.state.rolls).toEqual({});
    }
  });

  it("a tie replays the round from the first seat", () => {
    const first = applyCloRoll(live("clo", 5), "a", [2, 2, 4]);
    const tie = applyCloRoll(first.state, "b", [5, 5, 4]);
    expect(tie.effect).toEqual({ type: "tie", nextUid: "a" });
    expect(tie.record).toMatchObject({ winner: null, points: 0, label: "Tie" });
    expect(tie.state.rolls).toEqual({});
    expect(tie.state.round).toBe(2);
  });

  it("reaching the target completes the match", () => {
    const close = live("clo", 5, { scores: { a: 3, b: 4 } });
    const first = applyCloRoll(close, "a", [6, 6, 1]);
    const final = applyCloRoll(first.state, "b", [4, 5, 6]);
    expect(final.state).toMatchObject({ status: "complete", winner: "b", endReason: "target" });
    expect(final.state.scores.b).toBe(7);
  });

  it("rejects the wrong turn, a finished match, bad dice, and another game's roll", () => {
    expect(() => applyCloRoll(live("clo", 5), "b", [1, 1, 2])).toThrow("NOT_YOUR_TURN");
    expect(() => applyCloRoll(live("clo", 5), "z", [1, 1, 2])).toThrow("NOT_A_PLAYER");
    expect(() => applyCloRoll(live("clo", 5, { status: "complete" }), "a", [1, 1, 2])).toThrow("NOT_IN_PROGRESS");
    expect(() => applyCloRoll(live("clo", 5), "a", [1, 1])).toThrow("BAD_DICE");
    expect(() => applyCloRoll(live("clo", 5), "a", [1, 1, 7])).toThrow("BAD_DICE");
    expect(() => applyCloRoll(live("craps", 5), "a", [1, 1, 2])).toThrow("WRONG_MODE");
  });
});

describe("4-5-6 (instant)", () => {
  it("4-5-6 or trips wins the round on the spot", () => {
    const r = applyCloRoll(live("s456", 5), "a", [6, 4, 5]);
    expect(r.effect).toMatchObject({ type: "round", winnerUid: "a", points: 3 });
    const trips = applyCloRoll(live("s456", 5), "a", [3, 3, 3]);
    expect(trips.effect).toMatchObject({ type: "round", winnerUid: "a", points: 2 });
  });

  it("1-2-3 hands the other player 1 point on the spot", () => {
    const r = applyCloRoll(live("s456", 5), "a", [1, 2, 3]);
    expect(r.effect).toMatchObject({ type: "round", winnerUid: "b", points: 1 });
    expect(r.record?.label).toBe("1-2-3");
    expect(r.callout).toBe("Bail");
  });

  it("a point still has to be beaten", () => {
    const first = applyCloRoll(live("s456", 5), "a", [2, 2, 6]);
    expect(first.effect).toEqual({ type: "advance", nextUid: "b" });
    const second = applyCloRoll(first.state, "b", [1, 1, 3]);
    expect(second.effect).toMatchObject({ type: "round", winnerUid: "a", points: 1 });
  });
});

describe("Craps", () => {
  it("a natural scores 1 and passes the dice", () => {
    const r = applyCrapsRoll(live("craps", 5), "a", [3, 4]);
    expect(r).toMatchObject({ label: "Natural 7", outcome: "natural" });
    expect(r.state.scores.a).toBe(1);
    expect(r.state.turns).toEqual({ a: 1, b: 0 });
    expect(r.state.current).toBe(1);
    expect(r.effect).toMatchObject({ type: "round", winnerUid: "a", points: 1, nextUid: "b" });
  });

  it("craps on the come-out scores nothing", () => {
    const r = applyCrapsRoll(live("craps", 5), "a", [6, 6]);
    expect(r).toMatchObject({ label: "Craps 12", outcome: "craps" });
    expect(r.effect).toMatchObject({ type: "round", winnerUid: null, points: 0 });
    expect(r.record?.winner).toBeNull();
  });

  it("sets a point, keeps rolling, and scores 2 for a made point or 3 for a hard 4/10", () => {
    const set = applyCrapsRoll(live("craps", 5), "a", [3, 3]);
    expect(set).toMatchObject({ label: "Point 6", outcome: "point", effect: { type: "again" } });
    const keep = applyCrapsRoll(set.state, "a", [5, 6]);
    expect(keep).toMatchObject({ label: "11 · still on 6", outcome: "continue" });
    const made = applyCrapsRoll(keep.state, "a", [2, 4]);
    expect(made).toMatchObject({ label: "Made the 6", outcome: "made" });
    expect(made.state.scores.a).toBe(2);
    const hard = applyCrapsRoll(live("craps", 5, { point: 10 }), "a", [5, 5]);
    expect(hard.state.scores.a).toBe(3);
  });

  it("a seven-out scores nothing", () => {
    const r = applyCrapsRoll(live("craps", 5, { point: 8 }), "a", [3, 4]);
    expect(r).toMatchObject({ label: "Seven out", outcome: "sevenout" });
    expect(r.state.point).toBeNull();
  });

  it("the second shooter always gets a hand before the match is decided", () => {
    const close = live("craps", 5, { scores: { a: 4, b: 0 }, turns: { a: 3, b: 3 }, round: 4 });
    const first = applyCrapsRoll(close, "a", [5, 6]);
    expect(first.state.status).toBe("active");
    expect(first.state.round).toBe(4);
    const last = applyCrapsRoll(first.state, "b", [1, 1]);
    expect(last.state).toMatchObject({ status: "complete", winner: "a" });
  });

  it("rejects bad dice and another game", () => {
    expect(() => applyCrapsRoll(live("craps", 5), "a", [1, 2, 3])).toThrow("BAD_DICE");
    expect(() => applyCrapsRoll(live("clo", 5), "a", [1, 2])).toThrow("WRONG_MODE");
  });
});

describe("10,000", () => {
  const start = (): DiceMatch => live("ten", 5000);

  it("a fresh turn throws six dice and waits for a keep choice", () => {
    expect(tenRollCount(start(), "a", [])).toBe(6);
    const r = applyTenRoll(start(), "a", [], [1, 5, 2, 3, 4, 6]);
    expect(r).toMatchObject({ outcome: "rolled", label: "Up to 1,500 on the table", effect: { type: "again" } });
    const plain = applyTenRoll(start(), "a", [], [1, 5, 2, 3, 3, 6]);
    expect(plain).toMatchObject({ outcome: "rolled", label: "Up to 150 on the table", callout: null });
    expect(plain.state.ten.rolled).toEqual([1, 5, 2, 3, 3, 6]);
  });

  it("keeps scoring dice, rolls the rest, and banks the turn", () => {
    const first = applyTenRoll(start(), "a", [], [1, 5, 2, 3, 3, 6]);
    expect(tenRollCount(first.state, "a", [0])).toBe(5);
    const second = applyTenRoll(first.state, "a", [0], [5, 5, 5, 2, 3]);
    expect(second.state.ten).toMatchObject({ turnScore: 100, kept: [1] });
    const bank = applyTenBank(second.state, "a", [0, 1, 2]);
    expect(bank).toMatchObject({ label: "Banked 600", outcome: "banked" });
    expect(bank.state.scores.a).toBe(600);
    expect(bank.state.ten).toEqual({ turnScore: 0, kept: [], rolled: [] });
    expect(bank.state.current).toBe(1);
  });

  it("a farkle loses the turn's points", () => {
    const first = applyTenRoll(start(), "a", [], [1, 5, 2, 3, 3, 6]);
    const bust = applyTenRoll(first.state, "a", [0, 1], [2, 3, 4, 6]);
    expect(bust).toMatchObject({ label: "Farkle · lost 150", outcome: "farkle", callout: "Bail" });
    expect(bust.state.scores.a).toBe(0);
    expect(bust.state.turns.a).toBe(1);
    const cold = applyTenRoll(start(), "a", [], [2, 2, 3, 4, 6, 6]);
    expect(cold.label).toBe("Farkle");
  });

  it("hot dice: all six set aside rolls six again", () => {
    const first = applyTenRoll(start(), "a", [], [1, 1, 1, 5, 5, 2]);
    const next = applyTenRoll(first.state, "a", [0, 1, 2, 3, 4], [5]);
    expect(next.state.ten.kept).toEqual([1, 1, 1, 5, 5]);
    expect(tenRollCount(next.state, "a", [0])).toBe(6);
    const hot = applyTenRoll(next.state, "a", [0], [1, 2, 3, 4, 6, 6]);
    expect(hot).toMatchObject({ outcome: "hot", label: "Hot dice", callout: "Hot dice" });
    expect(hot.state.ten.turnScore).toBe(1150);
  });

  it("rejects bad keeps, banking with nothing on the table, and the wrong dice count", () => {
    const first = applyTenRoll(start(), "a", [], [1, 5, 2, 3, 3, 6]);
    expect(() => applyTenRoll(first.state, "a", [], [1, 2, 3, 4, 5])).toThrow("BAD_KEEP");
    expect(() => applyTenRoll(first.state, "a", [2], [1, 2, 3, 4, 5])).toThrow("BAD_KEEP");
    expect(() => applyTenRoll(first.state, "a", [0, 2], [1, 2, 3, 4])).toThrow("BAD_KEEP");
    expect(() => applyTenRoll(first.state, "a", [0, 0], [1, 2, 3, 4])).toThrow("BAD_KEEP");
    expect(() => applyTenRoll(first.state, "a", [9], [1, 2, 3, 4, 5])).toThrow("BAD_KEEP");
    expect(() => applyTenRoll(first.state, "a", [0], [1, 2, 3])).toThrow("BAD_DICE");
    expect(() => applyTenRoll(start(), "a", [0], [1, 2, 3, 4, 5, 6])).toThrow("BAD_KEEP");
    expect(() => applyTenBank(start(), "a", [0])).toThrow("NOTHING_TO_BANK");
    expect(() => applyTenBank(live("clo", 5), "a", [0])).toThrow("WRONG_MODE");
    expect(() => tenRollCount(live("clo", 5), "a", [])).toThrow("WRONG_MODE");
  });

  it("decides the race only after equal turns", () => {
    const close = live("ten", 5000, {
      scores: { a: 4900, b: 1000 },
      turns: { a: 5, b: 5 },
      ten: { turnScore: 0, kept: [], rolled: [1, 1, 2, 3, 4, 6] },
    });
    const banked = applyTenBank(close, "a", [0, 1]);
    expect(banked.state.status).toBe("active");
    const reply = applyTenBank(
      { ...banked.state, ten: { turnScore: 0, kept: [], rolled: [5, 2, 3, 3, 4, 6] } },
      "b",
      [0],
    );
    expect(reply.state).toMatchObject({ status: "complete", winner: "a" });
  });
});
