import { describe, expect, it } from "vitest";
import {
  applyCloRoll,
  applyDecline,
  applyQuit,
  applyTimeout,
  decideDiceTimeout,
  freshMatch,
  matchHasStarted,
  statsDelta,
  TURN_DURATION_MS,
} from "./engine.js";
import type { DiceMatch } from "./engine.js";

const P1 = "u1";
const P2 = "u2";
const P3 = "u3";

function two(): DiceMatch {
  return freshMatch([P1, P2]);
}

describe("applyCloRoll — Got Em rollClo semantics, match continues", () => {
  it("reroll outcome rolls again on the same turn", () => {
    const next = applyCloRoll(two(), P1, [1, 3, 5]);
    expect(next.effect).toEqual({ type: "reroll" });
    expect(next.state.current).toBe(0);
    expect(next.state.rolls[P1]).toBeUndefined();
    expect(next.label).toBe("RE-ROLL");
    expect(next.state.status).toBe("active");
  });

  it("records a determinate roll and advances to the next player", () => {
    const next = applyCloRoll(two(), P1, [2, 2, 5]);
    expect(next.state.rolls[P1]).toEqual([2, 2, 5]);
    expect(next.state.current).toBe(1);
    expect(next.effect).toEqual({ type: "advance", nextUid: P2 });
    expect(next.label).toBe("POINT 5");
  });

  it("a challenger's 4-5-6 does not win the round before the opponent rolls", () => {
    const next = applyCloRoll(two(), P1, [4, 5, 6]);
    expect(next.state.status).toBe("active");
    expect(next.state.winner).toBeNull();
    expect(next.state.current).toBe(1);
    expect(next.state.roundsWon[P1]).toBe(0);
  });

  it("when both have rolled the higher rank wins the round and the match stays open", () => {
    const afterP1 = applyCloRoll(two(), P1, [2, 2, 3]).state;
    const next = applyCloRoll(afterP1, P2, [2, 2, 6]);
    expect(next.effect).toEqual({ type: "round", roundWinnerUid: P2, nextUid: P1 });
    expect(next.state.status).toBe("active");
    expect(next.state.winner).toBeNull();
    expect(next.state.roundsWon[P2]).toBe(1);
    expect(next.state.roundsWon[P1]).toBe(0);
    expect(next.state.rolls).toEqual({});
    expect(next.state.round).toBe(2);
    expect(next.state.current).toBe(0);
  });

  it("4-5-6 (rank 1000) beats a point and the next round returns to the challenger", () => {
    const afterP1 = applyCloRoll(two(), P1, [2, 2, 6]).state;
    const next = applyCloRoll(afterP1, P2, [4, 5, 6]);
    expect(next.effect.type).toBe("round");
    if (next.effect.type !== "round") throw new Error("expected a round");
    expect(next.effect.roundWinnerUid).toBe(P2);
    expect(next.state.roundsWon[P2]).toBe(1);
    expect(next.state.current).toBe(0);
  });

  it("tie on top rank clears tied rolls and resets to the first tied seat", () => {
    const afterP1 = applyCloRoll(two(), P1, [3, 3, 5]).state;
    const next = applyCloRoll(afterP1, P2, [1, 1, 5]);
    expect(next.state.status).toBe("active");
    expect(next.state.rolls[P1]).toBeUndefined();
    expect(next.state.rolls[P2]).toBeUndefined();
    expect(next.state.current).toBe(0);
    expect(next.state.round).toBe(2);
    expect(next.state.roundsWon[P1]).toBe(0);
    expect(next.effect).toEqual({ type: "tie", nextUid: P1 });
  });

  it("advances to the next un-rolled tied seat, skipping a valid roll", () => {
    let state = freshMatch([P1, P2, P3]);
    state = applyCloRoll(state, P1, [2, 2, 5]).state;
    state = applyCloRoll(state, P2, [1, 1, 3]).state;
    const tied = applyCloRoll(state, P3, [3, 3, 5]);
    expect(tied.state.current).toBe(0);
    expect(tied.state.status).toBe("active");
    expect(tied.state.rolls[P2]).toEqual([1, 1, 3]);
    expect(tied.state.rolls[P1]).toBeUndefined();
    expect(tied.state.rolls[P3]).toBeUndefined();

    const after = applyCloRoll(tied.state, P1, [4, 5, 6]);
    expect(after.state.current).toBe(2);
    expect(after.state.status).toBe("active");
    expect(after.effect).toEqual({ type: "advance", nextUid: P3 });
  });

  it("rejects a roll when it is not the caller's turn", () => {
    expect(() => applyCloRoll(two(), P2, [2, 2, 5])).toThrow("NOT_YOUR_TURN");
  });

  it("rejects a roll when the match is not in progress", () => {
    const done = applyQuit(two(), P1);
    expect(() => applyCloRoll(done, P1, [2, 2, 5])).toThrow("NOT_IN_PROGRESS");
  });

  it("rejects dice that are not three faces in 1..6", () => {
    expect(() => applyCloRoll(two(), P1, [1, 2])).toThrow("BAD_DICE");
    expect(() => applyCloRoll(two(), P1, [0, 1, 2])).toThrow("BAD_DICE");
  });

  it("a second round can be won by the other player and both round counts stick", () => {
    let state = applyCloRoll(two(), P1, [2, 2, 3]).state;
    state = applyCloRoll(state, P2, [2, 2, 6]).state;
    state = applyCloRoll(state, P1, [6, 6, 6]).state;
    state = applyCloRoll(state, P2, [1, 1, 2]).state;
    expect(state.roundsWon).toEqual({ [P1]: 1, [P2]: 1 });
    expect(state.round).toBe(3);
    expect(state.status).toBe("active");
  });
});

describe("quit, decline, and timeout", () => {
  it("a challenger who quits before rolling voids the match with no stats", () => {
    const next = applyQuit(two(), P1);
    expect(next.status).toBe("expired");
    expect(next.winner).toBeNull();
    expect(statsDelta(next)).toBeNull();
  });

  it("an opponent who declines before the match starts writes no stats", () => {
    const next = applyDecline(two(), P2);
    expect(next.status).toBe("declined");
    expect(next.endReason).toBe("decline");
    expect(statsDelta(next)).toBeNull();
  });

  it("the challenger cannot decline", () => {
    expect(() => applyDecline(two(), P1)).toThrow("NOT_DECLINABLE");
  });

  it("decline is refused once anyone has rolled", () => {
    const started = applyCloRoll(two(), P1, [1, 2, 4]).state;
    expect(() => applyDecline(started, P2)).toThrow("NOT_DECLINABLE");
  });

  it("quitting after play starts forfeits the match to the player who stayed", () => {
    const started = applyCloRoll(two(), P1, [2, 2, 5]).state;
    const next = applyQuit(started, P1);
    expect(next.status).toBe("forfeit");
    expect(next.winner).toBe(P2);
    expect(next.endReason).toBe("quit");
    expect(statsDelta(next)).toEqual({ winnerUid: P2, loserUid: P1 });
  });

  it("an opponent who quits before anyone rolls is a decline, not a forfeit", () => {
    const next = applyQuit(two(), P2);
    expect(next.status).toBe("declined");
    expect(statsDelta(next)).toBeNull();
  });

  it("a stranger cannot quit", () => {
    expect(() => applyQuit(two(), "nope")).toThrow("NOT_A_PLAYER");
  });

  it("an unstarted turn that times out expires with no winner", () => {
    const deadline = 1_000;
    const decision = decideDiceTimeout(two(), deadline, deadline);
    expect(decision).toEqual({ action: "expired" });
    const next = applyTimeout(two(), deadline + 1, deadline);
    expect(next?.status).toBe("expired");
    expect(next?.winner).toBeNull();
    expect(statsDelta(next!)).toBeNull();
  });

  it("a timeout before the deadline changes nothing", () => {
    expect(decideDiceTimeout(two(), 500, 1_000)).toEqual({ action: "none" });
    expect(applyTimeout(two(), 500, 1_000)).toBeNull();
  });

  it("a timeout after a re-roll forfeits to the waiting player", () => {
    const started = applyCloRoll(two(), P1, [1, 3, 5]).state;
    expect(matchHasStarted(started)).toBe(true);
    const deadline = 5_000;
    const next = applyTimeout(started, deadline, deadline);
    expect(next?.status).toBe("forfeit");
    expect(next?.winner).toBe(P2);
    expect(next?.endReason).toBe("timeout");
  });

  it("a timeout on the opponent's turn forfeits to the challenger", () => {
    const started = applyCloRoll(two(), P1, [2, 2, 5]).state;
    const next = applyTimeout(started, 10, 10);
    expect(next?.winner).toBe(P1);
    expect(statsDelta(next!)).toEqual({ winnerUid: P1, loserUid: P2 });
  });

  it("a finished match is not timed out again", () => {
    const done = applyQuit(two(), P1);
    expect(decideDiceTimeout(done, 99, 1)).toEqual({ action: "none" });
  });

  it("uses the same 24h window as S.K.A.T.E.", () => {
    expect(TURN_DURATION_MS).toBe(24 * 60 * 60 * 1000);
  });
});
