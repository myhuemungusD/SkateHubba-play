import { describe, it, expect } from "vitest";
import { deriveMyStats, humanizeDuration } from "../deriveMyStats";
import type { UserProfile } from "../../../services/users";

function buildProfile(overrides?: Partial<UserProfile>): UserProfile {
  return { uid: "me", username: "viewer", stance: "regular", createdAt: null, ...overrides };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("humanizeDuration", () => {
  it("floors anything under a minute rather than printing 0m", () => {
    expect(humanizeDuration(0)).toBe("<1m");
    expect(humanizeDuration(59_999)).toBe("<1m");
  });

  it("renders whole minutes below an hour", () => {
    expect(humanizeDuration(42 * MINUTE)).toBe("42m");
  });

  it("renders hours with and without a minute remainder", () => {
    expect(humanizeDuration(3 * HOUR)).toBe("3h");
    expect(humanizeDuration(3 * HOUR + 20 * MINUTE)).toBe("3h 20m");
  });

  it("renders days with and without an hour remainder", () => {
    expect(humanizeDuration(2 * DAY)).toBe("2d");
    expect(humanizeDuration(2 * DAY + 5 * HOUR + 30 * MINUTE)).toBe("2d 5h");
  });

  it("guards against a non-finite duration", () => {
    expect(humanizeDuration(Number.NaN)).toBe("<1m");
  });
});

describe("deriveMyStats", () => {
  it("reads a legacy doc as zeros with no rates", () => {
    const s = deriveMyStats(buildProfile());
    expect(s).toMatchObject({
      gamesPlayed: 0,
      gamesAbandoned: 0,
      avgGameLength: null,
      avgLettersTaken: null,
      trickConsistency: null,
      tricksLanded: 0,
      tricksFailed: 0,
      cleanWins: 0,
      comebackWins: 0,
      gamesJudged: 0,
      turnsJudged: 0,
      lettersGiven: 0,
      lettersTaken: 0,
    });
  });

  it("falls back to wins + losses when gamesPlayed is absent", () => {
    expect(deriveMyStats(buildProfile({ wins: 3, losses: 5 })).gamesPlayed).toBe(8);
  });

  it("prefers the gamesPlayed counter over wins + losses", () => {
    expect(deriveMyStats(buildProfile({ wins: 3, losses: 5, gamesPlayed: 9 })).gamesPlayed).toBe(9);
  });

  it("averages game length over the games that contributed a duration", () => {
    const profile = buildProfile({
      // gamesPlayed is deliberately larger: games closed out before the
      // duration counters shipped must not drag the average down.
      gamesPlayed: 10,
      gamesWithDuration: 4,
      totalGameDurationMs: 4 * (2 * HOUR + 30 * MINUTE),
    });
    expect(deriveMyStats(profile).avgGameLength).toBe("2h 30m");
  });

  it("leaves game length unavailable when no game has contributed a duration", () => {
    // Legacy doc: games played and a summed duration, but no denominator.
    const legacy = buildProfile({ gamesPlayed: 4, totalGameDurationMs: 4 * HOUR });
    expect(deriveMyStats(legacy).avgGameLength).toBeNull();
    // Explicit zero reads the same as absent.
    const zeroed = buildProfile({ gamesPlayed: 4, gamesWithDuration: 0, totalGameDurationMs: 4 * HOUR });
    expect(deriveMyStats(zeroed).avgGameLength).toBeNull();
  });

  it("averages letters taken per game to one decimal", () => {
    expect(deriveMyStats(buildProfile({ gamesPlayed: 4, lettersTaken: 7 })).avgLettersTaken).toBe("1.8");
  });

  it("computes trick consistency from landed over attempted", () => {
    expect(deriveMyStats(buildProfile({ tricksLanded: 9, tricksFailed: 3 })).trickConsistency).toBe(75);
  });

  it("leaves consistency unavailable when no trick has been attempted", () => {
    expect(deriveMyStats(buildProfile({ gamesPlayed: 2 })).trickConsistency).toBeNull();
  });

  it("carries the judging and abandon counters through untouched", () => {
    const s = deriveMyStats(buildProfile({ forfeitLosses: 2, gamesJudged: 6, turnsJudged: 31 }));
    expect(s.gamesAbandoned).toBe(2);
    expect(s.gamesJudged).toBe(6);
    expect(s.turnsJudged).toBe(31);
  });
});
