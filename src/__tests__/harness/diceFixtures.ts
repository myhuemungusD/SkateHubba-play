import type { DiceGameDoc, DiceRollView } from "../../services/dice";

/** A Roll Dice match with sane defaults; override anything. u1 is "kit", u2 is "fox". */
export function diceGame(overrides: Partial<DiceGameDoc> = {}): DiceGameDoc {
  return {
    id: "g1",
    player1Uid: "u1",
    player2Uid: "u2",
    player1Username: "kit",
    player2Username: "fox",
    mode: "clo",
    target: 5,
    status: "active",
    currentTurn: "u1",
    round: 1,
    scores: { u1: 0, u2: 0 },
    roundsWon: { u1: 0, u2: 0 },
    results: {},
    point: null,
    ten: { turnScore: 0, kept: [], rolled: [] },
    turns: { u1: 0, u2: 0 },
    rollCount: 0,
    accepted: true,
    winner: null,
    endReason: null,
    updatedAt: 1,
    createdAt: 1,
    turnDeadline: Date.now() + 20 * 3_600_000,
    lastRoll: null,
    rounds: [],
    repChange: null,
    rematchGameId: null,
    nudgedAt: null,
    ...overrides,
  };
}

export function diceRoll(overrides: Partial<DiceRollView> = {}): DiceRollView {
  return {
    uid: "u1",
    dice: [2, 2, 5],
    outcome: "point",
    label: "Point 5",
    callout: null,
    rollId: "r1",
    at: 1,
    ...overrides,
  };
}
