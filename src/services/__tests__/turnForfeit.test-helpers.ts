/**
 * Shared GameDoc fixtures for the turn-forfeit test suite.
 *
 * Lives in a `*.test-helpers.ts` file so it is excluded from coverage and from
 * the test-duplication scan (which only walks `*.test.ts`). Both the decision
 * tests and the client/server parity test build their game docs from here so
 * the fixture shape stays in one place.
 */
import type { GameDoc } from "../games.mappers";

/** Fixed reference clock used across the forfeit tests. */
export const FORFEIT_NOW = 1_700_000_000_000;

/** Minimal Timestamp-like stub: only `toMillis` is read by the helper. */
export function makeDeadline(ms: number): GameDoc["turnDeadline"] {
  return { toMillis: () => ms } as unknown as GameDoc["turnDeadline"];
}

/** Build a base active GameDoc whose current turn is already expired. */
export function makeGameDoc(overrides: Partial<GameDoc> = {}): GameDoc {
  return {
    id: "g1",
    player1Uid: "p1",
    player2Uid: "p2",
    player1Username: "alice",
    player2Username: "bob",
    p1Letters: 1,
    p2Letters: 2,
    status: "active",
    currentTurn: "p1",
    phase: "setting",
    currentSetter: "p1",
    currentTrickName: "Kickflip",
    currentTrickVideoUrl: "https://vid/set.webm",
    matchVideoUrl: "https://vid/match.webm",
    turnDeadline: makeDeadline(FORFEIT_NOW - 1),
    turnNumber: 5,
    winner: null,
    createdAt: null,
    updatedAt: null,
    spotId: "11111111-1111-1111-1111-111111111111",
    ...overrides,
  };
}
