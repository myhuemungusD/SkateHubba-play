/**
 * Shared GameDoc fixture for the dispute-resolution test suite.
 *
 * Lives in a `*.test-helpers.ts` file so it is excluded from coverage and from
 * the test-duplication scan (which only walks `*.test.ts`). Keeping the fixture
 * here also stops it colliding with the near-identical GameDoc fixtures the
 * other service suites build.
 */
import type { GameDoc } from "../games.mappers";

/** Fixed reference clock used across the dispute-resolution tests. */
export const DISPUTE_NOW = 1_700_000_000_000;

/** Minimal Timestamp-like stub: the helpers never read turnDeadline/reviewDeadline. */
export function stubTs(): GameDoc["turnDeadline"] {
  return { toMillis: () => 0 } as unknown as GameDoc["turnDeadline"];
}

/**
 * Base game frozen in communityReview: setter=p1 (disputer), matcher=p2
 * (claimer), no letters yet. Override per-case.
 */
export function makeDisputeGame(overrides: Partial<GameDoc> = {}): GameDoc {
  return {
    id: "g1",
    player1Uid: "p1",
    player2Uid: "p2",
    player1Username: "alice",
    player2Username: "bob",
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    currentTurn: "p1",
    phase: "communityReview",
    currentSetter: "p1",
    currentTrickName: "Kickflip",
    currentTrickVideoUrl: "https://vid/set.webm",
    matchVideoUrl: "https://vid/match.webm",
    turnDeadline: stubTs(),
    turnNumber: 3,
    winner: null,
    createdAt: null,
    updatedAt: null,
    reviewFor: "p2",
    reviewDeadline: stubTs(),
    ...overrides,
  };
}
