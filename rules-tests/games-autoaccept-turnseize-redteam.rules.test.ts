/**
 * Games — red-team guard on the EXPIRED-DISPUTE AUTO-ACCEPT branch.
 *
 * When a judge's review window expires, any participant can finalise the
 * matcher's "landed" call. Auto-accept means roles swap: currentSetter
 * ROTATES to the matcher (setter's opponent), currentTurn follows, and
 * turnNumber advances by 1 — exactly like the honor-system-landed match
 * resolution branch. Before the fix this branch pinned letters/players/
 * judge/winner/turnDeadline but NOT currentSetter/currentTurn/turnNumber, so
 * either participant could seize the setter role out of rotation in the same
 * write. (audit HIGH: turn seize)
 *
 * Fixture: phase = disputable, currentSetter = P1 (so matcher = P2), an
 * ALREADY-EXPIRED turnDeadline, an active judge.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { updateDoc } from "firebase/firestore";
import { setupRulesTestEnv, seedValidGame, authedContext, gameDoc, activeSettingUpdate } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-games-autoaccept-turnseize-redteam";

const P1_UID = "p1-alice";
const P2_UID = "p2-bob";
const JUDGE_UID = "j-charlie";
const GAME_ID = "g-autoaccept";

const VALID_MATCH_URL = "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/match.webm";

const getEnv = setupRulesTestEnv(PROJECT_ID);

// Seed an expired disputable game. turnDeadline is in the PAST so the
// auto-accept branch's `request.time > resource.data.turnDeadline` fires.
const seedExpiredDisputable = (overrides: Record<string, unknown> = {}) =>
  seedValidGame(
    getEnv(),
    GAME_ID,
    { player1Uid: P1_UID, player2Uid: P2_UID },
    {
      phase: "disputable",
      currentSetter: P1_UID,
      currentTurn: JUDGE_UID,
      judgeId: JUDGE_UID,
      judgeStatus: "accepted",
      turnNumber: 5,
      matchVideoUrl: VALID_MATCH_URL,
      turnDeadline: new Date(Date.now() - 60_000),
      ...overrides,
    },
  );

// The CORRECT post-auto-accept write: roles rotate to the matcher (P2),
// currentTurn follows the new setter, and turnNumber advances (seed is 5 → 6).
// Each attack overrides ONLY the field it tampers with, so the tampered value
// is explicit at the call site and no two sites share enough lines to trip
// check:test-dup regardless of how prettier wraps them.
const autoAcceptResolve = (overrides: Record<string, unknown> = {}) =>
  activeSettingUpdate({ currentSetter: P2_UID, currentTurn: P2_UID, turnNumber: 6, ...overrides });

describe("games — expired-dispute auto-accept turn seize", () => {
  it("attack: participant auto-accepts but FREEZES the setter role (no rotation)", async () => {
    await seedExpiredDisputable();
    // Correct post-auto-accept: currentSetter → P2. Here P1 keeps the setter
    // role AND the turn — the seize the missing pins used to allow.
    await assertFails(
      updateDoc(
        gameDoc(authedContext(getEnv(), P1_UID), GAME_ID),
        autoAcceptResolve({ currentSetter: P1_UID, currentTurn: P1_UID }), // SEIZE — must rotate to P2
      ),
    );
  });

  it("attack: participant auto-accepts, rotates setter, but seizes currentTurn to the other player", async () => {
    await seedExpiredDisputable();
    // currentSetter rotates to P2 (correct) but currentTurn is pointed at P1,
    // breaking the currentTurn == currentSetter pin.
    await assertFails(
      updateDoc(
        gameDoc(authedContext(getEnv(), P2_UID), GAME_ID),
        autoAcceptResolve({ currentTurn: P1_UID }), // SEIZE — must equal the new setter (P2)
      ),
    );
  });

  it("attack: participant auto-accepts but freezes turnNumber", async () => {
    await seedExpiredDisputable();
    await assertFails(
      updateDoc(
        gameDoc(authedContext(getEnv(), P2_UID), GAME_ID),
        autoAcceptResolve({ turnNumber: 5 }), // FROZEN — must be resource.turnNumber + 1
      ),
    );
  });

  it("legitimate: participant auto-accepts, roles swap to the matcher, turnNumber + 1", async () => {
    await seedExpiredDisputable();
    // No overrides: the builder's defaults ARE the correct rotation (P2 setter,
    // P2 turn, turnNumber + 1).
    await assertSucceeds(updateDoc(gameDoc(authedContext(getEnv(), P2_UID), GAME_ID), autoAcceptResolve()));
  });
});
