/**
 * Firestore rules tests for the games collection — specifically the spotId
 * invariants added by the April 2026 map audit P0 #3 polish pass.
 *
 * These run OUT of the vitest unit suite because they spin up a real
 * Firestore emulator and need a network port (8080). Run with:
 *
 *     npm run test:rules
 *
 * which uses `firebase emulators:exec` to boot the emulator, apply the
 * project's firestore.rules file, and run this test file against it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
  type RulesTestContext,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { doc, setDoc, updateDoc, serverTimestamp, setLogLevel } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules";
const DB_NAME = "skatehubba";

const P1_UID = "p1-alice";
const P2_UID = "p2-bob";
const VALID_SPOT_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_SPOT_ID = "22222222-3333-4444-5555-666666666666";

let testEnv: RulesTestEnvironment;

/**
 * Build a game doc that passes every existing create-rule invariant so we
 * can isolate the spotId-specific assertions from unrelated rejections.
 * Callers override only the fields they're testing.
 */
function makeValidGame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    player1Uid: P1_UID,
    player2Uid: P2_UID,
    player1Username: "alice",
    player2Username: "bob",
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    currentTurn: P1_UID,
    phase: "setting",
    currentSetter: P1_UID,
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnNumber: 1,
    winner: null,
    turnHistory: [],
    // 24h in the future — satisfies the "turnDeadline > now" guard
    turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function asP1(): RulesTestContext {
  return testEnv.authenticatedContext(P1_UID, { email_verified: true });
}

function asP2(): RulesTestContext {
  return testEnv.authenticatedContext(P2_UID, { email_verified: true });
}

function gameRef(ctx: RulesTestContext, id: string) {
  return doc(ctx.firestore(), "games", id);
}

beforeAll(async () => {
  // Quiet the noisy "firestore is running in offline mode" warning that
  // rules-unit-testing prints for each context.
  setLogLevel("error");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
      // The production app uses a named database (not the default).
      // rules-unit-testing reads this from the connection URL.
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe("games rules — spotId invariants", () => {
  describe("create", () => {
    it("accepts a game with no spotId (baseline)", async () => {
      await assertSucceeds(setDoc(gameRef(asP1(), "g1"), makeValidGame()));
    });

    it("accepts a game with a string spotId", async () => {
      await assertSucceeds(setDoc(gameRef(asP1(), "g1"), makeValidGame({ spotId: VALID_SPOT_ID })));
    });

    it("rejects a non-string spotId", async () => {
      await assertFails(setDoc(gameRef(asP1(), "g1"), makeValidGame({ spotId: 12345 })));
    });

    it("rejects a spotId that is not a string (object)", async () => {
      await assertFails(setDoc(gameRef(asP1(), "g1"), makeValidGame({ spotId: { injected: true } })));
    });

    it("rejects a spotId longer than 64 characters", async () => {
      await assertFails(setDoc(gameRef(asP1(), "g1"), makeValidGame({ spotId: "x".repeat(65) })));
    });

    it("accepts a spotId exactly 64 characters", async () => {
      await assertSucceeds(setDoc(gameRef(asP1(), "g1"), makeValidGame({ spotId: "x".repeat(64) })));
    });
  });

  describe("update — immutability", () => {
    // Helper: seed an existing game as P1 via a test-only bypass, then update it
    // from a real authenticated context. Using testEnv.withSecurityRulesDisabled
    // is the canonical pattern for seeding state that rules would otherwise
    // reject (e.g. the rate-limit duration check on create).
    async function seedGame(overrides: Record<string, unknown> = {}): Promise<void> {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "games", "g1"), {
          ...makeValidGame(overrides),
          // Back-date updatedAt so the 2s turn-action rate limit passes.
          updatedAt: new Date(Date.now() - 60_000),
        });
      });
    }

    it("rejects adding a spotId to a previously-spotless game", async () => {
      await seedGame();
      // P1 attempts to set trick AND inject a spotId — should be rejected
      // by the immutability clause in the normal turn-update rule.
      await assertFails(
        updateDoc(gameRef(asP1(), "g1"), {
          phase: "matching",
          currentTrickName: "kickflip",
          currentTurn: P2_UID,
          turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
          updatedAt: serverTimestamp(),
          spotId: VALID_SPOT_ID,
        }),
      );
    });

    it("rejects changing an existing spotId on a turn update", async () => {
      await seedGame({ spotId: VALID_SPOT_ID });
      await assertFails(
        updateDoc(gameRef(asP1(), "g1"), {
          phase: "matching",
          currentTrickName: "kickflip",
          currentTurn: P2_UID,
          turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
          updatedAt: serverTimestamp(),
          spotId: OTHER_SPOT_ID,
        }),
      );
    });

    it("accepts a normal turn update that leaves spotId untouched", async () => {
      await seedGame({ spotId: VALID_SPOT_ID });
      await assertSucceeds(
        updateDoc(gameRef(asP1(), "g1"), {
          phase: "matching",
          currentTrickName: "kickflip",
          // setting→matching requires a real trick video URL (April 2026
          // hardening against the setter-turn-handoff exploit — see
          // games-setter-turnhandoff-redteam.rules.test.ts).
          currentTrickVideoUrl: "https://example.com/set.webm",
          currentTurn: P2_UID,
          turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    it("rejects removing an existing spotId on a turn update", async () => {
      // Firestore doesn't have a native "delete field" in an update call
      // at the rules level (deletes come through as a missing field in the
      // resource data). This test asserts that merging a spotless payload
      // over a spotted game does not effectively strip the field via a
      // hand-crafted setDoc that would.
      await seedGame({ spotId: VALID_SPOT_ID });
      // A full rewrite (setDoc without merge) effectively drops spotId.
      await assertFails(setDoc(gameRef(asP1(), "g1"), makeValidGame()));
    });

    it("rejects changing spotId on a match-resolution update", async () => {
      await seedGame({ spotId: VALID_SPOT_ID, phase: "matching", currentTurn: P2_UID });
      await assertFails(
        updateDoc(gameRef(asP2(), "g1"), {
          phase: "setting",
          currentSetter: P2_UID,
          currentTurn: P2_UID,
          currentTrickName: null,
          currentTrickVideoUrl: null,
          matchVideoUrl: null,
          turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
          updatedAt: serverTimestamp(),
          spotId: OTHER_SPOT_ID,
        }),
      );
    });

    it("rejects changing spotId on a forfeit update", async () => {
      // Back-date turnDeadline so the forfeit rule's "deadline expired" guard passes.
      await seedGame({ spotId: VALID_SPOT_ID, turnDeadline: new Date(Date.now() - 60_000) });
      await assertFails(
        updateDoc(gameRef(asP2(), "g1"), {
          status: "forfeit",
          winner: P2_UID,
          updatedAt: serverTimestamp(),
          spotId: OTHER_SPOT_ID,
        }),
      );
    });
  });
});
