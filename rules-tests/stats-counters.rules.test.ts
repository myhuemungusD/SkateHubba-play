/**
 * Stats counters — PR-A2 strict-counter rule red team.
 *
 * The `users/{uid}` update rule (firestore.rules, plan §4.2) was tightened
 * in PR-A2 to require a fresh linked `/games` doc whenever any of the
 * denormalized stats counters changes (gamesWon, gamesLost,
 * gamesForfeited, tricksLanded, currentWinStreak, longestWinStreak, xp,
 * level, cleanJudgments). This suite proves:
 *
 *   - Legitimate winner / loser / forfeiter writes pass.
 *   - Replay, stale-game farming, wrong-winner self-promotion, and
 *     per-write delta inflation all DENY.
 *   - The Sybil 5-game soft gate is enforced by Sentry only — the rule
 *     itself accepts the write (audit S8).
 *   - Existing non-counter writes (lastGameCreatedAt rate-limit anchor)
 *     remain ALLOWED — audit S14 regression check.
 *
 * 14 scenarios per plan §6.2, plus 6 scenarios (#15–20) for the
 * mid-game `tricksLanded` carve-out (post-A2 audit BLOCKER fix —
 * `applyTrickLanded` stages tricksLanded/tricksLandedThisGame under
 * an active game without advancing `lastStatsGameId`; the strict
 * terminal-proof path would reject the write and roll back the entire
 * turn-resolution transaction).
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import {
  assertSucceeds,
  assertFails,
  type RulesTestContext,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { Timestamp, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const OWNER_UID = "owner-uid";
const OPPONENT_UID = "opponent-uid";

// Each test uses a unique gameId so `lastStatsGameId` strictly advances
// even across the shared seeded user doc. The rule's strict-advance
// branch (request.resource.data.lastStatsGameId != resource.data.lastStatsGameId)
// would falsely fail if every test reused the same gameId after the
// owner doc carried a stale value from a prior run.
const FRESH_GAME_ID = "g-fresh";
const STALE_GAME_ID = "g-stale";
const FORFEIT_GAME_ID = "g-forfeit";
const PRIOR_GAME_ID = "g-prior"; // referenced by lastStatsGameId on initial owner seed

const getEnv: () => RulesTestEnvironment = setupRulesTestEnv("demo-skatehubba-rules-stats-counters");

function asOwner(): RulesTestContext {
  return getEnv().authenticatedContext(OWNER_UID, { email_verified: true });
}

function ownerRef(ctx: RulesTestContext) {
  return doc(ctx.firestore(), "users", OWNER_UID);
}

/**
 * Canonical "winner +1" payload referenced by every test in the
 * positive-winner / negative-winner suite. Extracted so the duplicate
 * gate stays green and the per-test deltas remain grep-able.
 */
const WINNER_PLUS_ONE = {
  gamesWon: 5,
  currentWinStreak: 2,
  longestWinStreak: 2,
  lastStatsGameId: FRESH_GAME_ID,
} as const;

/** Same as WINNER_PLUS_ONE but for tests that seed gamesWon: 1 (no prior wins). */
const WINNER_FROM_ZERO = {
  gamesWon: 2,
  currentWinStreak: 1,
  longestWinStreak: 1,
  lastStatsGameId: FRESH_GAME_ID,
} as const;

/** Seed a public users/{owner} doc with the supplied counter prior state. */
async function seedOwnerProfile(overrides: Record<string, unknown> = {}): Promise<void> {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", OWNER_UID), {
      uid: OWNER_UID,
      username: "alice",
      stance: "Regular",
      gamesWon: 0,
      gamesLost: 0,
      gamesForfeited: 0,
      tricksLanded: 0,
      tricksLandedThisGame: 0,
      currentWinStreak: 0,
      longestWinStreak: 0,
      cleanJudgments: 0,
      xp: 0,
      level: 1,
      lastStatsGameId: PRIOR_GAME_ID,
      ...overrides,
    });
  });
}

interface SeedGameOpts {
  status: "complete" | "forfeit";
  winner: string | null;
  /** ms ago — set >7200_000 for stale-game tests. */
  ageMs?: number;
}

/** Seed a games/{gameId} doc with the supplied terminal status + winner. */
async function seedGame(gameId: string, opts: SeedGameOpts): Promise<void> {
  const updatedAt = Timestamp.fromMillis(Date.now() - (opts.ageMs ?? 1000));
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "games", gameId), {
      player1Uid: OWNER_UID,
      player2Uid: OPPONENT_UID,
      player1Username: "alice",
      player2Username: "bob",
      status: opts.status,
      winner: opts.winner,
      // The rule only reads status/winner/playerNUid/updatedAt; the rest
      // of the GameDoc shape is irrelevant for these scenarios but we
      // keep it consistent with makeValidGame to avoid drift.
      p1Letters: 0,
      p2Letters: 0,
      currentTurn: OWNER_UID,
      phase: "setting",
      currentSetter: OWNER_UID,
      turnNumber: 1,
      turnHistory: [],
      turnDeadline: Timestamp.fromMillis(Date.now() + 60_000),
      createdAt: Timestamp.fromMillis(Date.now() - 60_000),
      updatedAt,
    });
  });
}

describe("users/{uid} — stats counter writes (PR-A2 strict path)", () => {
  it("(1) ALLOW: valid winner write (gamesWon += 1, streak += 1)", async () => {
    await seedOwnerProfile({ gamesWon: 4, currentWinStreak: 1, longestWinStreak: 2 });
    await seedGame(FRESH_GAME_ID, { status: "complete", winner: OWNER_UID });
    await assertSucceeds(
      updateDoc(ownerRef(asOwner()), {
        gamesWon: 5,
        currentWinStreak: 2,
        longestWinStreak: 2,
        lastStatsGameId: FRESH_GAME_ID,
      }),
    );
  });

  it("(2) ALLOW: valid loser write (gamesLost += 1, streak resets)", async () => {
    await seedOwnerProfile({ gamesLost: 3, currentWinStreak: 4, longestWinStreak: 4 });
    await seedGame(FRESH_GAME_ID, { status: "complete", winner: OPPONENT_UID });
    await assertSucceeds(
      updateDoc(ownerRef(asOwner()), {
        gamesLost: 4,
        currentWinStreak: 0,
        lastStatsGameId: FRESH_GAME_ID,
      }),
    );
  });

  it("(3) ALLOW: valid forfeit-winner write (opponent forfeited; gamesWon += 1)", async () => {
    await seedOwnerProfile({ gamesWon: 2, currentWinStreak: 0, longestWinStreak: 1 });
    await seedGame(FORFEIT_GAME_ID, { status: "forfeit", winner: OWNER_UID });
    await assertSucceeds(
      updateDoc(ownerRef(asOwner()), {
        gamesWon: 3,
        currentWinStreak: 1,
        longestWinStreak: 1,
        lastStatsGameId: FORFEIT_GAME_ID,
      }),
    );
  });

  it("(4) ALLOW: valid forfeit-loser write (forfeiter; streak resets to 0)", async () => {
    await seedOwnerProfile({ gamesForfeited: 1, currentWinStreak: 5, longestWinStreak: 5 });
    await seedGame(FORFEIT_GAME_ID, { status: "forfeit", winner: OPPONENT_UID });
    await assertSucceeds(
      updateDoc(ownerRef(asOwner()), {
        gamesForfeited: 2,
        currentWinStreak: 0,
        lastStatsGameId: FORFEIT_GAME_ID,
      }),
    );
  });

  it("(5) DENY: self-promote without lastStatsGameId change", async () => {
    await seedOwnerProfile({ gamesWon: 1 });
    await seedGame(FRESH_GAME_ID, { status: "complete", winner: OWNER_UID });
    // Note: lastStatsGameId omitted from the update — `request.resource.data.lastStatsGameId`
    // remains the seeded PRIOR_GAME_ID, failing the strict-advance clause.
    const { lastStatsGameId: _drop, ...withoutGameId } = WINNER_FROM_ZERO;
    await assertFails(updateDoc(ownerRef(asOwner()), withoutGameId));
  });

  it("(6) DENY: stale game (updatedAt > 2h old)", async () => {
    await seedOwnerProfile({ gamesWon: 1 });
    // 3h old — outside the 2h freshness window.
    await seedGame(STALE_GAME_ID, {
      status: "complete",
      winner: OWNER_UID,
      ageMs: 3 * 60 * 60 * 1000,
    });
    await assertFails(updateDoc(ownerRef(asOwner()), { ...WINNER_FROM_ZERO, lastStatsGameId: STALE_GAME_ID }));
  });

  it("(7) DENY: replay (same gameId, lastStatsGameId unchanged)", async () => {
    // Owner doc already records FRESH_GAME_ID as the last applied gameId,
    // so the strict-advance clause (`!= resource.data.lastStatsGameId`)
    // fails on the merged post-write state.
    await seedOwnerProfile({ gamesWon: 1, lastStatsGameId: FRESH_GAME_ID });
    await seedGame(FRESH_GAME_ID, { status: "complete", winner: OWNER_UID });
    await assertFails(updateDoc(ownerRef(asOwner()), { ...WINNER_FROM_ZERO }));
  });

  it("(8) DENY: wrong winner claim (auth.uid != game.winner, but gamesWon += 1)", async () => {
    await seedOwnerProfile({ gamesWon: 1 });
    // Opponent is the actual winner — owner cannot claim a win on this game.
    await seedGame(FRESH_GAME_ID, { status: "complete", winner: OPPONENT_UID });
    await assertFails(updateDoc(ownerRef(asOwner()), { ...WINNER_FROM_ZERO }));
  });

  it("(9) DENY: tricksLanded delta > 1 in single write", async () => {
    await seedOwnerProfile({ gamesWon: 4, tricksLanded: 3, currentWinStreak: 1, longestWinStreak: 1 });
    await seedGame(FRESH_GAME_ID, { status: "complete", winner: OWNER_UID });
    await assertFails(
      updateDoc(ownerRef(asOwner()), {
        ...WINNER_PLUS_ONE,
        tricksLanded: 5, // +2 from seeded 3, exceeds the per-write cap
      }),
    );
  });

  it("(10) DENY: tricksLandedThisGame > 6", async () => {
    await seedOwnerProfile({ gamesWon: 4, tricksLandedThisGame: 6, currentWinStreak: 1, longestWinStreak: 1 });
    await seedGame(FRESH_GAME_ID, { status: "complete", winner: OWNER_UID });
    await assertFails(updateDoc(ownerRef(asOwner()), { ...WINNER_PLUS_ONE, tricksLandedThisGame: 7 }));
  });

  it("(11) DENY: xp delta > 155 in single write", async () => {
    await seedOwnerProfile({ gamesWon: 4, xp: 100, currentWinStreak: 1, longestWinStreak: 1 });
    await seedGame(FRESH_GAME_ID, { status: "complete", winner: OWNER_UID });
    await assertFails(updateDoc(ownerRef(asOwner()), { ...WINNER_PLUS_ONE, xp: 300 }));
  });

  it("(12) DENY: negative xp delta", async () => {
    await seedOwnerProfile({ gamesWon: 4, xp: 500, currentWinStreak: 1, longestWinStreak: 1 });
    await seedGame(FRESH_GAME_ID, { status: "complete", winner: OWNER_UID });
    await assertFails(updateDoc(ownerRef(asOwner()), { ...WINNER_PLUS_ONE, xp: 400 }));
  });

  it("(13) ALLOW: Sybil prior < 5 — soft gate (rule allows; Sentry-flagged at service)", async () => {
    // Audit T4 / S8: rule does NOT block writes for users with fewer than
    // 5 prior games — that would break the legitimate first-time UX. The
    // soft gate lives in service-side Sentry breadcrumbs only.
    await seedOwnerProfile({ gamesWon: 0, gamesLost: 0, gamesForfeited: 0 });
    await seedGame(FRESH_GAME_ID, { status: "complete", winner: OWNER_UID });
    await assertSucceeds(
      updateDoc(ownerRef(asOwner()), {
        gamesWon: 1,
        currentWinStreak: 1,
        longestWinStreak: 1,
        lastStatsGameId: FRESH_GAME_ID,
      }),
    );
  });

  it("(14) ALLOW: regression — lastGameCreatedAt rate-limit anchor write still allowed (audit S14)", async () => {
    // Critical: writes that don't touch any counter must continue to pass
    // through the existing lastGameCreatedAt branch. The strict-counter
    // logic short-circuits on `!statsCountersChanged()`. If this test
    // ever fails, the new rule has accidentally broken every game-create
    // flow in production.
    await seedOwnerProfile();
    await assertSucceeds(
      updateDoc(ownerRef(asOwner()), {
        lastGameCreatedAt: serverTimestamp(),
      }),
    );
  });

  // ── Mid-game tricksLanded carve-out (post-A2 audit BLOCKER) ──
  // The honor-system clean-landed path (applyTrickLanded) stages
  // `{tricksLanded: increment(1), tricksLandedThisGame: increment(1)}`
  // mid-game — the linked game is `active`, not terminal, and
  // `lastStatsGameId` is NOT advanced. Without the carve-out the
  // strict terminal-proof path would reject these writes, rolling
  // back the entire per-turn transaction in production.

  it("(15) ALLOW: mid-game trick increment (tricksLanded + tricksLandedThisGame, both +1)", async () => {
    await seedOwnerProfile({ tricksLanded: 2, tricksLandedThisGame: 2 });
    await assertSucceeds(
      updateDoc(ownerRef(asOwner()), {
        tricksLanded: 3,
        tricksLandedThisGame: 3,
      }),
    );
  });

  it("(16) DENY: mid-game trick increment when tricksLandedThisGame would exceed 6", async () => {
    // Per-game cap enforced atomically in the rule (constraint 4 of
    // midGameTrickWriteOk). Service-side cap in applyTrickLanded
    // already early-returns at perGame >= 6 — this is defence-in-depth.
    await seedOwnerProfile({ tricksLanded: 5, tricksLandedThisGame: 6 });
    await assertFails(
      updateDoc(ownerRef(asOwner()), {
        tricksLanded: 6,
        tricksLandedThisGame: 7,
      }),
    );
  });

  it("(17) DENY: trick increment combined with gamesWon change (only-these-fields constraint)", async () => {
    // Constraint 1 of midGameTrickWriteOk: role transitions
    // (gamesWon/gamesLost/gamesForfeited/streaks/xp/level) cannot
    // piggyback on the carve-out — they still require terminal
    // game proof via strictCounterDeltaOk.
    await seedOwnerProfile({ tricksLanded: 2, tricksLandedThisGame: 2, gamesWon: 0 });
    await assertFails(
      updateDoc(ownerRef(asOwner()), {
        tricksLanded: 3,
        tricksLandedThisGame: 3,
        gamesWon: 1,
      }),
    );
  });

  it("(18) DENY: tricksLanded delta != +1", async () => {
    // Constraint 2 of midGameTrickWriteOk: per-write trick delta is
    // exactly +1. A larger delta (here +3) implies catch-up writes
    // and is rejected to prevent batch-grinding past the cap.
    await seedOwnerProfile({ tricksLanded: 2, tricksLandedThisGame: 2 });
    await assertFails(
      updateDoc(ownerRef(asOwner()), {
        tricksLanded: 5,
        tricksLandedThisGame: 3,
      }),
    );
  });

  it("(19) DENY: tricksLandedThisGame delta != +1 (mismatched deltas)", async () => {
    // Constraint 3 of midGameTrickWriteOk: per-game counter must
    // also advance by exactly +1. Mismatched deltas signal client-
    // side desync between lifetime and per-game tallies.
    await seedOwnerProfile({ tricksLanded: 2, tricksLandedThisGame: 2 });
    await assertFails(
      updateDoc(ownerRef(asOwner()), {
        tricksLanded: 3,
        tricksLandedThisGame: 5,
      }),
    );
  });

  it("(20) DENY: trick increment that ALSO advances lastStatsGameId (path conflation)", async () => {
    // Constraint 5 of midGameTrickWriteOk: the carve-out is mid-
    // game by definition — advancing lastStatsGameId would conflate
    // the mid-game and terminal paths. Forces callers to pick one
    // branch per write.
    await seedOwnerProfile({ tricksLanded: 2, tricksLandedThisGame: 2 });
    await assertFails(
      updateDoc(ownerRef(asOwner()), {
        tricksLanded: 3,
        tricksLandedThisGame: 3,
        lastStatsGameId: FRESH_GAME_ID,
      }),
    );
  });

  // ── Game-create reset carve-out (post-A2 audit BLOCKER-1) ──
  // After adding `tricksLandedThisGame` to `statsCountersChanged()`,
  // games.create.ts's `{ lastGameCreatedAt: serverTimestamp(),
  // tricksLandedThisGame: 0 }` write needs an explicit carve-out.

  it("(21) ALLOW: tricksLandedThisGame reset to 0 alongside lastGameCreatedAt write", async () => {
    await seedOwnerProfile({ tricksLandedThisGame: 4 });
    await assertSucceeds(
      updateDoc(ownerRef(asOwner()), {
        tricksLandedThisGame: 0,
        lastGameCreatedAt: serverTimestamp(),
      }),
    );
  });

  it("(22) DENY: tricksLandedThisGame reset to 0 WITHOUT lastGameCreatedAt advance", async () => {
    // Bare reset (no game-create proof) is exactly the cap-bypass
    // attack the carve-out is designed to block.
    await seedOwnerProfile({ tricksLandedThisGame: 6 });
    await assertFails(
      updateDoc(ownerRef(asOwner()), {
        tricksLandedThisGame: 0,
      }),
    );
  });

  it("(23) DENY: tricksLandedThisGame reset to non-zero alongside lastGameCreatedAt", async () => {
    // The carve-out only permits `== 0`. A reset to 5 with the
    // game-create proof must still fail because it could be used to
    // pre-load the per-game counter behind a real game-create write.
    await seedOwnerProfile({ tricksLandedThisGame: 6 });
    await assertFails(
      updateDoc(ownerRef(asOwner()), {
        tricksLandedThisGame: 5,
        lastGameCreatedAt: serverTimestamp(),
      }),
    );
  });

  // ── longestWinStreak inflation defence (post-A2 audit BLOCKER-2) ──

  it("(24) DENY: standard loss with longestWinStreak inflation", async () => {
    await seedOwnerProfile({ gamesLost: 3, currentWinStreak: 4, longestWinStreak: 4 });
    await seedGame(FRESH_GAME_ID, { status: "complete", winner: OPPONENT_UID });
    await assertFails(
      updateDoc(ownerRef(asOwner()), {
        gamesLost: 4,
        currentWinStreak: 0,
        longestWinStreak: 9999, // inflation attempt — must be denied
        lastStatsGameId: FRESH_GAME_ID,
      }),
    );
  });

  it("(25) DENY: forfeit-loss with longestWinStreak inflation", async () => {
    await seedOwnerProfile({ gamesForfeited: 1, currentWinStreak: 5, longestWinStreak: 5 });
    await seedGame(FORFEIT_GAME_ID, { status: "forfeit", winner: OPPONENT_UID });
    await assertFails(
      updateDoc(ownerRef(asOwner()), {
        gamesForfeited: 2,
        currentWinStreak: 0,
        longestWinStreak: 9999, // inflation attempt — must be denied
        lastStatsGameId: FORFEIT_GAME_ID,
      }),
    );
  });
});
