/**
 * Typed test-data factories for smoke tests.
 *
 * Each factory takes a `Partial<T>` of overrides and returns a fully-typed
 * object. The returned objects are loose clones intended for use with the
 * harness mock module builders — they satisfy the structural shape each
 * screen inspects without importing Firestore types into the test harness
 * (the real services spread raw snapshot data into these shapes anyway).
 */
import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";

/** Minimal Firebase Auth-like user shape used by `useAuth()` mocks. */
export interface MockAuthUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName?: string | null;
}

/** Signed-in user whose email is not yet verified. */
export const authedUser: MockAuthUser = {
  uid: "u1",
  email: "sk8r@test.com",
  emailVerified: false,
};

/** Signed-in user whose email IS verified (unlocks challenge/rematch flows). */
export const verifiedUser: MockAuthUser = {
  uid: "u1",
  email: "sk8r@test.com",
  emailVerified: true,
};

/**
 * Canonical fully-populated test profile. Screens only read `username` and
 * `stance`, but the full shape keeps us honest against `UserProfile`.
 */
export const testProfile: UserProfile = {
  uid: "u1",
  username: "sk8r",
  stance: "regular",
  createdAt: null,
};

/**
 * Build an active game doc with the common defaults smoke tests share.
 * Override any subset via the `overrides` argument — Partial<GameDoc>.
 */
export function activeGame(overrides: Partial<GameDoc> = {}): GameDoc {
  const base: GameDoc = {
    id: "game1",
    player1Uid: "u1",
    player2Uid: "u2",
    player1Username: "sk8r",
    player2Username: "rival",
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    currentTurn: "u1",
    phase: "setting",
    currentSetter: "u1",
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    // Firestore Timestamp-like shim — screens only call `.toMillis()`.
    turnDeadline: { toMillis: () => Date.now() + 86_400_000 } as unknown as GameDoc["turnDeadline"],
    turnNumber: 1,
    winner: null,
    createdAt: null,
    updatedAt: null,
  };
  return { ...base, ...overrides };
}
