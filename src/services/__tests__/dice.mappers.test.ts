import { describe, expect, it } from "vitest";
import { DICE_TARGETS, REP_START, isDiceMode, toDiceGame, toDiceStats } from "../dice.mappers";

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 2,
    player1Uid: "u1",
    player2Uid: "u2",
    player1Username: "kit",
    player2Username: "fox",
    game: "craps",
    target: 9,
    status: "active",
    currentTurn: "u1",
    round: 2,
    scores: { u1: 3, u2: 1 },
    roundsWon: { u1: 1, u2: 0 },
    results: { u1: { dice: [2, 2, 5] }, u2: { dice: [1, 2] } },
    point: 6,
    ten: { turnScore: 300, kept: [1, 5], rolled: [2, 3, 4, 6] },
    turns: { u1: 2, u2: 1 },
    rollCount: 3,
    accepted: true,
    winner: "u1",
    endReason: "target",
    updatedAt: 10,
    createdAt: 5,
    turnDeadline: 20,
    lastRoll: { uid: "u1", dice: [3, 3], outcome: "made", label: "Made the 6", callout: "Clean", rollId: "r9", at: 9 },
    rounds: [
      {
        round: 1,
        winner: "u1",
        points: 2,
        label: "Made the 6",
        hands: { u1: { dice: [3, 3], label: "Made" }, u2: "x" },
        at: 4,
      },
      "junk",
      { hands: null },
    ],
    repChange: { u1: 16, u2: -16, u3: 5 },
    rematchGameId: "g2",
    nudgedAt: 7,
    ...overrides,
  };
}

describe("toDiceGame", () => {
  it("reads every v2 field", () => {
    const game = toDiceGame("g1", raw());
    expect(game).toMatchObject({
      id: "g1",
      mode: "craps",
      target: 9,
      scores: { u1: 3, u2: 1 },
      results: { u1: [2, 2, 5] },
      point: 6,
      ten: { turnScore: 300, kept: [1, 5], rolled: [2, 3, 4, 6] },
      turns: { u1: 2, u2: 1 },
      accepted: true,
      endReason: "target",
      createdAt: 5,
      repChange: { u1: 16, u2: -16 },
      rematchGameId: "g2",
      nudgedAt: 7,
    });
    expect(game?.lastRoll).toEqual({
      uid: "u1",
      dice: [3, 3],
      outcome: "made",
      label: "Made the 6",
      callout: "Clean",
      rollId: "r9",
      at: 9,
    });
    expect(game?.rounds).toEqual([
      { round: 1, winner: "u1", points: 2, label: "Made the 6", hands: { u1: { dice: [3, 3], label: "Made" } }, at: 4 },
      { round: 2, winner: null, points: 0, label: "", hands: {}, at: 0 },
    ]);
  });

  it("reads a v1 C-Lo match as a race to 5 with rounds won as points", () => {
    const game = toDiceGame("old", {
      player1Uid: "u1",
      player2Uid: "u2",
      status: "active",
      roundsWon: { u1: 2, u2: 1 },
      lastRoll: { uid: "u1", dice: [2, 2, 5], outcome: "point", label: "POINT 5", at: 3 },
    });
    expect(game).toMatchObject({
      mode: "clo",
      target: DICE_TARGETS.clo[0],
      scores: { u1: 2, u2: 1 },
      point: null,
      ten: { turnScore: 0, kept: [], rolled: [] },
      turns: { u1: 0, u2: 0 },
      accepted: false,
      rounds: [],
      repChange: null,
      rematchGameId: null,
      nudgedAt: null,
      createdAt: 0,
    });
    expect(game?.lastRoll?.rollId).toBe("u1:3:225");
    expect(game?.lastRoll?.callout).toBeNull();
  });

  it("defaults a bad target, mode and seat maps", () => {
    const game = toDiceGame(
      "g1",
      raw({ game: "poker", target: 7, scores: null, roundsWon: null, turns: "x", repChange: { u3: 1 } }),
    );
    expect(game).toMatchObject({
      mode: "clo",
      target: 5,
      scores: { u1: 0, u2: 0 },
      turns: { u1: 0, u2: 0 },
      repChange: null,
    });
    expect(toDiceGame("g1", raw({ target: "9" }))?.target).toBe(5);
    expect(toDiceGame("g1", raw({ game: "ten", target: 9 }))?.target).toBe(5000);
    expect(toDiceGame("g1", raw({ repChange: { u1: 5, u2: "x" } }))?.repChange).toEqual({ u1: 5 });
    expect(toDiceGame("g1", raw({ repChange: "x", rematchGameId: "" }))).toMatchObject({
      repChange: null,
      rematchGameId: null,
    });
  });

  it("defaults missing optional fields", () => {
    const game = toDiceGame(
      "g1",
      raw({
        player1Username: 1,
        currentTurn: 4,
        round: "two",
        rollCount: Number.NaN,
        winner: null,
        endReason: "nope",
        updatedAt: "x",
        turnDeadline: undefined,
        lastRoll: null,
        results: [1],
        point: "6",
        ten: null,
        rounds: "nope",
      }),
    );
    expect(game).toMatchObject({
      player1Username: "",
      currentTurn: null,
      round: 1,
      rollCount: 0,
      winner: null,
      endReason: null,
      updatedAt: 0,
      turnDeadline: 0,
      lastRoll: null,
      results: {},
      point: null,
      rounds: [],
    });
  });

  it("drops a last roll that is not dice", () => {
    expect(toDiceGame("g1", raw({ lastRoll: { dice: [] } }))?.lastRoll).toBeNull();
    expect(toDiceGame("g1", raw({ lastRoll: { dice: [1, 2, 3, 4, 5, 6, 1] } }))?.lastRoll).toBeNull();
    expect(toDiceGame("g1", raw({ lastRoll: { dice: [1, 2, "6"] } }))?.lastRoll).toBeNull();
    expect(toDiceGame("g1", raw({ lastRoll: { dice: [0, 7] } }))?.lastRoll).toBeNull();
    expect(toDiceGame("g1", raw({ lastRoll: [1, 2] }))?.lastRoll).toBeNull();
    expect(toDiceGame("g1", raw({ lastRoll: { dice: [4] } }))?.lastRoll).toMatchObject({
      uid: "",
      label: "",
      rollId: ":0:4",
    });
  });

  it("drops a document that is not a match", () => {
    expect(toDiceGame("g1", undefined)).toBeNull();
    expect(toDiceGame("g1", raw({ player1Uid: "" }))).toBeNull();
    expect(toDiceGame("g1", raw({ player1Uid: 1 }))).toBeNull();
    expect(toDiceGame("g1", raw({ player2Uid: "" }))).toBeNull();
    expect(toDiceGame("g1", raw({ status: "done" }))).toBeNull();
  });

  it.each(["pending", "active", "complete", "forfeit", "declined", "expired"] as const)(
    "reads a %s match",
    (status) => {
      expect(toDiceGame("g1", raw({ status }))?.status).toBe(status);
    },
  );
});

describe("toDiceStats", () => {
  it("starts everyone at the base Rep", () => {
    expect(toDiceStats(undefined)).toEqual({
      wins: 0,
      losses: 0,
      gamesPlayed: 0,
      rep: REP_START,
      peakRep: REP_START,
      streak: 0,
      bestStreak: 0,
    });
  });

  it("reads Rep, peak and streaks, and never shows a peak below the current Rep", () => {
    expect(
      toDiceStats({ wins: 2, losses: "no", gamesPlayed: 3, rep: 1040, peakRep: 1060, streak: 2, bestStreak: 3 }),
    ).toEqual({
      wins: 2,
      losses: 0,
      gamesPlayed: 3,
      rep: 1040,
      peakRep: 1060,
      streak: 2,
      bestStreak: 3,
    });
    expect(toDiceStats({ rep: 1100 }).peakRep).toBe(1100);
  });
});

describe("isDiceMode", () => {
  it("accepts only the four games", () => {
    expect(isDiceMode("ten")).toBe(true);
    expect(isDiceMode("poker")).toBe(false);
    expect(isDiceMode(3)).toBe(false);
  });
});
