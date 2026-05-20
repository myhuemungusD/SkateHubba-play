/**
 * turnHistory growth red-team — proves the H-R3 April 2026 hardening that
 * caps appends to `games.turnHistory`.
 *
 * Before the fix, NONE of the game write paths capped turnHistory growth.
 * A player could `arrayUnion` a fabricated 1 MB TurnRecord on every write
 * and inflate the doc past Firestore's 1 MB limit, soft-bricking the game.
 *
 * Rules now require BOTH:
 *   (1) size grows by at most ONE entry per write, AND
 *   (2) absolute size stays ≤ 200 (SKATE ceiling × safety margin).
 *
 * Enforced in every growth-capable branch via the shared
 * `turnHistoryGrowthOk()` helper:
 *   - match resolution (matching phase)
 *   - dispute resolution (disputable, judge)
 *   - Call BS resolution (setReview, judge)
 *   - expired dispute auto-accept
 *   - expired setReview auto-clear
 *
 * Run via:  npm run test:rules
 */
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
  type RulesTestContext,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { arrayUnion, doc, serverTimestamp, setDoc, updateDoc, setLogLevel } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-turnhistory-redteam";

const P1_UID = "p1-alice";
const P2_UID = "p2-bob";
const GAME_ID = "g-turnhistory";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

let testEnv: RulesTestEnvironment;

function asP1(): RulesTestContext {
  return testEnv.authenticatedContext(P1_UID, { email_verified: true });
}

function asP2(): RulesTestContext {
  return testEnv.authenticatedContext(P2_UID, { email_verified: true });
}

function gameRef(ctx: RulesTestContext) {
  return doc(ctx.firestore(), "games", GAME_ID);
}

function makeTurnRecord(turnNumber: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    turnNumber,
    trickName: "kickflip",
    setterUid: P1_UID,
    setterUsername: "alice",
    matcherUid: P2_UID,
    matcherUsername: "bob",
    setVideoUrl: "https://firebasestorage.googleapis.com/test/set.webm",
    matchVideoUrl: "https://firebasestorage.googleapis.com/test/match.webm",
    landed: false,
    letterTo: P2_UID,
    judgedBy: null,
    ...overrides,
  };
}

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
    turnDeadline: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
    createdAt: serverTimestamp(),
    // Back-date so the 2s turn-action cooldown passes immediately.
    updatedAt: new Date(Date.now() - 60_000),
    ...overrides,
  };
}

async function seedGame(overrides: Record<string, unknown> = {}): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "games", GAME_ID), makeValidGame(overrides));
  });
}

beforeAll(async () => {
  setLogLevel("error");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe("games.turnHistory — growth caps", () => {
  describe("match-resolution branch (missed)", () => {
    function seedMatching(existingHistory: unknown[] = []) {
      return seedGame({
        currentTurn: P2_UID,
        currentSetter: P1_UID,
        phase: "matching",
        currentTrickName: "kickflip",
        currentTrickVideoUrl: "https://firebasestorage.googleapis.com/test/set.webm",
        turnHistory: existingHistory,
      });
    }

    it("legitimate: matcher can append exactly ONE TurnRecord on a missed attempt", async () => {
      await seedMatching([]);
      await assertSucceeds(
        updateDoc(gameRef(asP2()), {
          p2Letters: 1,
          phase: "setting",
          currentTurn: P1_UID,
          currentTrickName: null,
          currentTrickVideoUrl: null,
          matchVideoUrl: null,
          turnDeadline: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
          turnHistory: arrayUnion(makeTurnRecord(1)),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    it("attack: CANNOT append TWO TurnRecords in a single write", async () => {
      await seedMatching([]);
      await assertFails(
        updateDoc(gameRef(asP2()), {
          p2Letters: 1,
          phase: "setting",
          currentTurn: P1_UID,
          currentTrickName: null,
          currentTrickVideoUrl: null,
          matchVideoUrl: null,
          turnDeadline: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
          // Two fabricated records at once — growth == +2, must reject.
          turnHistory: arrayUnion(makeTurnRecord(1), makeTurnRecord(2)),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    it("attack: CANNOT balloon turnHistory past 200 entries", async () => {
      // Seed the history at exactly the 200 cap so any further append (+1)
      // crosses the ceiling and the write must reject.
      const seeded = Array.from({ length: 200 }, (_, i) => makeTurnRecord(i + 1));
      await seedMatching(seeded);
      await assertFails(
        updateDoc(gameRef(asP2()), {
          p2Letters: 1,
          phase: "setting",
          currentTurn: P1_UID,
          currentTrickName: null,
          currentTrickVideoUrl: null,
          matchVideoUrl: null,
          turnDeadline: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
          turnHistory: arrayUnion(makeTurnRecord(201)),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    it("attack: CANNOT replace turnHistory with a giant fabricated list", async () => {
      // Wholesale replacement with a 500-entry list — both the growth
      // delta (500 - 0 != 1) and the absolute cap are violated.
      await seedMatching([]);
      const fabricated = Array.from({ length: 500 }, (_, i) => makeTurnRecord(i + 1));
      await assertFails(
        updateDoc(gameRef(asP2()), {
          p2Letters: 1,
          phase: "setting",
          currentTurn: P1_UID,
          currentTrickName: null,
          currentTrickVideoUrl: null,
          matchVideoUrl: null,
          turnDeadline: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
          turnHistory: fabricated,
          updatedAt: serverTimestamp(),
        }),
      );
    });

    it("legitimate: appending the 200th entry is still allowed", async () => {
      // Seed 199 → append one → new size 200 → within the cap.
      const seeded = Array.from({ length: 199 }, (_, i) => makeTurnRecord(i + 1));
      await seedMatching(seeded);
      await assertSucceeds(
        updateDoc(gameRef(asP2()), {
          p2Letters: 1,
          phase: "setting",
          currentTurn: P1_UID,
          currentTrickName: null,
          currentTrickVideoUrl: null,
          matchVideoUrl: null,
          turnDeadline: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
          turnHistory: arrayUnion(makeTurnRecord(200)),
          updatedAt: serverTimestamp(),
        }),
      );
    });
  });

  describe("match-resolution branch (landed, honor system)", () => {
    it("legitimate: landed path can append a single TurnRecord", async () => {
      await seedGame({
        currentTurn: P2_UID,
        currentSetter: P1_UID,
        phase: "matching",
        currentTrickName: "kickflip",
        currentTrickVideoUrl: "https://firebasestorage.googleapis.com/test/set.webm",
        turnHistory: [],
      });
      await assertSucceeds(
        updateDoc(gameRef(asP2()), {
          matchVideoUrl: "https://firebasestorage.googleapis.com/test/match.webm",
          phase: "setting",
          currentSetter: P2_UID,
          currentTurn: P2_UID,
          turnNumber: 2,
          turnDeadline: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
          turnHistory: arrayUnion(makeTurnRecord(1, { landed: true, letterTo: null })),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    it("attack: landed path CANNOT bypass the +1 cap", async () => {
      await seedGame({
        currentTurn: P2_UID,
        currentSetter: P1_UID,
        phase: "matching",
        currentTrickName: "kickflip",
        currentTrickVideoUrl: "https://firebasestorage.googleapis.com/test/set.webm",
        turnHistory: [],
      });
      await assertFails(
        updateDoc(gameRef(asP2()), {
          matchVideoUrl: "https://firebasestorage.googleapis.com/test/match.webm",
          phase: "setting",
          currentSetter: P2_UID,
          currentTurn: P2_UID,
          turnNumber: 2,
          turnDeadline: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
          turnHistory: arrayUnion(
            makeTurnRecord(1, { landed: true, letterTo: null }),
            makeTurnRecord(2, { landed: true, letterTo: null }),
          ),
          updatedAt: serverTimestamp(),
        }),
      );
    });
  });

  describe("setting-phase branch (turn transitions)", () => {
    it("attack: current-turn player CANNOT append to turnHistory in the setting-phase rule", async () => {
      // setting-phase updates must keep turnHistory identical. This path
      // has always enforced the invariant — re-test as a regression guard.
      await seedGame({
        currentTurn: P1_UID,
        phase: "setting",
        turnHistory: [],
      });
      await assertFails(
        updateDoc(gameRef(asP1()), {
          phase: "matching",
          currentTrickName: "kickflip",
          currentTrickVideoUrl: "https://firebasestorage.googleapis.com/test/set.webm",
          currentTurn: P2_UID,
          turnDeadline: new Date(Date.now() + TWENTY_FOUR_HOURS_MS),
          turnHistory: arrayUnion(makeTurnRecord(999)),
          updatedAt: serverTimestamp(),
        }),
      );
    });
  });
});
