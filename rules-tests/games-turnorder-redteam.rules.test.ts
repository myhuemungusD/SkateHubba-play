/**
 * Games — red-team regression guards on long-standing turn-order and
 * letter-award invariants. These aren't new hardening but any complete
 * red-team pass needs them: a rules rewrite could silently open turn-
 * order bypasses or forge letter increments, and that would be silent
 * data corruption for real users.
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
import { doc, setDoc, updateDoc, serverTimestamp, setLogLevel } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-games-turnorder-redteam";

const P1_UID = "p1-alice";
const P2_UID = "p2-bob";
const GAME_ID = "g-turn";

let testEnv: RulesTestEnvironment;

function asP1(): RulesTestContext {
  return testEnv.authenticatedContext(P1_UID, { email_verified: true });
}

function asP2(): RulesTestContext {
  return testEnv.authenticatedContext(P2_UID, { email_verified: true });
}

function makeActiveGame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    player1Uid: P1_UID,
    player2Uid: P2_UID,
    player1Username: "alice",
    player2Username: "bob",
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    currentTurn: P1_UID, // P1's turn by default
    phase: "setting",
    currentSetter: P1_UID,
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnNumber: 1,
    winner: null,
    turnHistory: [],
    turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: serverTimestamp(),
    // Back-date updatedAt so the 2s turn-action rate limiter passes.
    updatedAt: new Date(Date.now() - 60_000),
    ...overrides,
  };
}

async function seedGame(overrides: Record<string, unknown> = {}): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "games", GAME_ID), makeActiveGame(overrides));
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

describe("games — red-team regression guards on game state", () => {
  it("attack: non-current-turn player CANNOT increment opponent's letter count", async () => {
    // It's P1's turn. P2 tries to submit an update that awards themselves
    // a letter (or any other change). Must fail on `request.auth.uid ==
    // resource.data.currentTurn` clause across all update branches.
    await seedGame({ currentTurn: P1_UID, phase: "matching" });
    await assertFails(
      updateDoc(doc(asP2().firestore(), "games", GAME_ID), {
        p1Letters: 1,
        phase: "setting",
        currentTurn: P1_UID,
        turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("attack: non-current-turn player CANNOT skip turn order (write while opponent's turn)", async () => {
    // It's P1's turn. P2 tries to write anything, phase transition or not.
    await seedGame({ currentTurn: P1_UID, phase: "setting" });
    await assertFails(
      updateDoc(doc(asP2().firestore(), "games", GAME_ID), {
        phase: "matching",
        currentTrickName: "kickflip",
        currentTurn: P1_UID,
        turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("attack: current-turn player CANNOT award letters during a setting→matching turn", async () => {
    // Setting-phase updates must keep letter counts identical — this is
    // the rule branch that blocks a setter from handing themselves a
    // letter while setting a trick.
    await seedGame({ currentTurn: P1_UID, phase: "setting" });
    await assertFails(
      updateDoc(doc(asP1().firestore(), "games", GAME_ID), {
        phase: "matching",
        currentTrickName: "kickflip",
        p2Letters: 1, // forged increment on opponent during setting update
        currentTurn: P2_UID,
        turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("legitimate: current-turn player CAN advance setting→matching without touching letters", async () => {
    await seedGame({ currentTurn: P1_UID, phase: "setting" });
    await assertSucceeds(
      updateDoc(doc(asP1().firestore(), "games", GAME_ID), {
        phase: "matching",
        currentTrickName: "kickflip",
        currentTrickVideoUrl: "https://example.com/set.webm",
        currentTurn: P2_UID,
        turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});
