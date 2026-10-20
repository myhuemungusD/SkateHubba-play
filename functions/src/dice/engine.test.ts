import { describe, expect, it } from "vitest";
import {
  applyAccept,
  applyDecline,
  applyQuit,
  applyTimeout,
  decideDiceTimeout,
  freshMatch,
  matchHasStarted,
  otherSeat,
  seatIndex,
  settleMatch,
  statsDelta,
  type DiceMatch,
} from "./engine.js";

const SEATS = ["a", "b"] as const;

function active(overrides: Partial<DiceMatch> = {}): DiceMatch {
  return { ...freshMatch(SEATS, "clo", 5), status: "active", accepted: true, ...overrides };
}

describe("freshMatch", () => {
  it("opens a pending race with zeroed scores", () => {
    const m = freshMatch(SEATS, "ten", 5000);
    expect(m).toMatchObject({ status: "pending", mode: "ten", target: 5000, current: 0, round: 1, accepted: false });
    expect(m.scores).toEqual({ a: 0, b: 0 });
    expect(m.turns).toEqual({ a: 0, b: 0 });
    expect(matchHasStarted(m)).toBe(false);
  });
});

describe("matchHasStarted", () => {
  it("is true after accept, a roll, a later round, a settled roll, or any score", () => {
    const base = freshMatch(SEATS, "clo", 5);
    expect(matchHasStarted({ ...base, accepted: true })).toBe(true);
    expect(matchHasStarted({ ...base, rollCount: 1 })).toBe(true);
    expect(matchHasStarted({ ...base, round: 2 })).toBe(true);
    expect(matchHasStarted({ ...base, rolls: { a: [1, 1, 2] } })).toBe(true);
    expect(matchHasStarted({ ...base, scores: { a: 0, b: 1 } })).toBe(true);
  });
});

describe("accept", () => {
  it("lets only the opponent accept a pending challenge, and the challenger opens", () => {
    const m = freshMatch(SEATS, "clo", 5);
    expect(() => applyAccept(m, "a")).toThrow("NOT_ACCEPTABLE");
    const after = applyAccept(m, "b");
    expect(after).toMatchObject({ status: "active", accepted: true, current: 0 });
    expect(() => applyAccept(after, "b")).toThrow("NOT_PENDING");
  });
});

describe("decline, cancel, quit", () => {
  it("opponent declines a pending challenge; challenger cannot", () => {
    const m = freshMatch(SEATS, "clo", 5);
    expect(applyDecline(m, "b")).toMatchObject({ status: "declined", endReason: "decline", winner: null });
    expect(() => applyDecline(m, "a")).toThrow("NOT_DECLINABLE");
  });

  it("legacy active matches can still be declined until someone rolls", () => {
    const legacy = { ...freshMatch(SEATS, "clo", 5), status: "active" as const };
    expect(applyDecline(legacy, "b").status).toBe("declined");
    expect(() => applyDecline({ ...legacy, rollCount: 1 }, "b")).toThrow("NOT_DECLINABLE");
    expect(() => applyDecline(active(), "b")).toThrow("NOT_DECLINABLE");
  });

  it("challenger leaving before play cancels; opponent leaving declines", () => {
    const m = freshMatch(SEATS, "clo", 5);
    expect(applyQuit(m, "a")).toMatchObject({ status: "expired", endReason: "cancel" });
    expect(applyQuit(m, "b")).toMatchObject({ status: "declined", endReason: "decline" });
    const legacy = { ...m, status: "active" as const };
    expect(applyQuit(legacy, "a").endReason).toBe("cancel");
  });

  it("leaving after play started forfeits to the player who stayed", () => {
    expect(applyQuit(active(), "a")).toMatchObject({ status: "forfeit", winner: "b", endReason: "quit" });
  });

  it("refuses a stranger and a finished match", () => {
    expect(() => applyQuit(active(), "z")).toThrow("NOT_A_PLAYER");
    expect(() => applyQuit(active({ status: "complete" }), "a")).toThrow("NOT_IN_PROGRESS");
  });
});

describe("timeouts", () => {
  it("does nothing before the deadline or on a finished match", () => {
    expect(decideDiceTimeout(active(), 5, 10)).toEqual({ action: "none" });
    expect(decideDiceTimeout(active({ status: "forfeit" }), 50, 10)).toEqual({ action: "none" });
    expect(applyTimeout(active(), 5, 10)).toBeNull();
  });

  it("expires an unanswered challenge and an unplayed legacy match", () => {
    expect(applyTimeout(freshMatch(SEATS, "clo", 5), 10, 10)).toMatchObject({
      status: "expired",
      endReason: "timeout",
    });
    const legacy = { ...freshMatch(SEATS, "clo", 5), status: "active" as const };
    expect(applyTimeout(legacy, 10, 10)?.status).toBe("expired");
  });

  it("forfeits a started match to whoever was waiting", () => {
    expect(applyTimeout(active({ current: 1 }), 10, 10)).toMatchObject({ status: "forfeit", winner: "a" });
    expect(applyTimeout(active({ current: 0 }), 10, 10)).toMatchObject({ status: "forfeit", winner: "b" });
  });

  it("throws when the roller seat is missing", () => {
    expect(() => decideDiceTimeout(active({ current: 5 }), 10, 10)).toThrow("NO_OPPONENT");
  });
});

describe("settleMatch", () => {
  it("ends C-Lo as soon as someone reaches the target", () => {
    expect(settleMatch(active({ scores: { a: 5, b: 3 } }))).toMatchObject({
      status: "complete",
      winner: "a",
      endReason: "target",
    });
    expect(settleMatch(active({ scores: { a: 4, b: 6 } })).winner).toBe("b");
    expect(settleMatch(active({ scores: { a: 4, b: 4 } })).status).toBe("active");
  });

  it("gives the second player their hand in alternating games", () => {
    const craps = active({ mode: "craps", scores: { a: 5, b: 3 }, turns: { a: 4, b: 3 } });
    expect(settleMatch(craps).status).toBe("active");
    expect(settleMatch({ ...craps, turns: { a: 4, b: 4 } }).winner).toBe("a");
  });

  it("plays on when tied at or over the target", () => {
    expect(
      settleMatch(active({ mode: "ten", target: 5000, scores: { a: 5200, b: 5200 }, turns: { a: 9, b: 9 } })).status,
    ).toBe("active");
  });

  it("leaves a finished match alone and needs two seats", () => {
    const done = active({ status: "forfeit" });
    expect(settleMatch(done)).toBe(done);
    expect(() => settleMatch({ ...active(), seats: ["a"] })).toThrow("NO_OPPONENT");
  });
});

describe("helpers and stats", () => {
  it("finds seats and the opponent", () => {
    expect(otherSeat(active(), "a")).toBe("b");
    expect(seatIndex(active(), "b")).toBe(1);
    expect(() => seatIndex(active(), "z")).toThrow("NOT_A_PLAYER");
    expect(() => otherSeat({ ...active(), seats: ["a"] }, "a")).toThrow("NO_OPPONENT");
  });

  it("only a decided match moves records", () => {
    expect(statsDelta(active({ status: "complete", winner: "b" }))).toEqual({ winnerUid: "b", loserUid: "a" });
    expect(statsDelta(active({ status: "forfeit", winner: "a" }))).toEqual({ winnerUid: "a", loserUid: "b" });
    expect(statsDelta(active({ status: "expired" }))).toBeNull();
    expect(statsDelta(active({ status: "complete", winner: null }))).toBeNull();
  });
});
