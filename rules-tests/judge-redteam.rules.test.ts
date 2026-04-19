/**
 * Judge invite accept — red-team tests for the defence-in-depth re-check
 * that judgeId is not either player, added in the April 2026 hardening.
 *
 * The create-time rule already blocks games where judgeId matches
 * player1Uid or player2Uid. This test ensures that if an older/corrupt
 * doc slipped through with judgeId == a player, the player cannot then
 * accept their own dispute and rule in their own favour.
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

const PROJECT_ID = "demo-skatehubba-rules-judge-redteam";

const P1_UID = "p1-alice";
const P2_UID = "p2-bob";
const JUDGE_UID = "j-charlie";
const GAME_ID = "g-judge";

let testEnv: RulesTestEnvironment;

function asP1(): RulesTestContext {
  return testEnv.authenticatedContext(P1_UID, { email_verified: true });
}

function asJudge(): RulesTestContext {
  return testEnv.authenticatedContext(JUDGE_UID, { email_verified: true });
}

function makeGameWithJudge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
    judgeId: JUDGE_UID,
    judgeStatus: "pending",
    judgeUsername: "charlie",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
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

describe("judge accept — red-team against player self-accept", () => {
  it("attack: player1 CANNOT accept as judge when a corrupt doc has judgeId == player1Uid", async () => {
    // Seed a pathological doc where judgeId equals player1Uid. This is
    // the precise scenario the re-check was added to block.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "games", GAME_ID), makeGameWithJudge({ judgeId: P1_UID }));
    });
    await assertFails(
      updateDoc(doc(asP1().firestore(), "games", GAME_ID), {
        judgeStatus: "accepted",
      }),
    );
  });

  it("attack: player2 CANNOT accept as judge when a corrupt doc has judgeId == player2Uid", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "games", GAME_ID), makeGameWithJudge({ judgeId: P2_UID }));
    });
    const asP2 = testEnv.authenticatedContext(P2_UID, { email_verified: true });
    await assertFails(
      updateDoc(doc(asP2.firestore(), "games", GAME_ID), {
        judgeStatus: "accepted",
      }),
    );
  });

  it("legitimate: third-party judge CAN accept a pending invite", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "games", GAME_ID), makeGameWithJudge());
    });
    await assertSucceeds(
      updateDoc(doc(asJudge().firestore(), "games", GAME_ID), {
        judgeStatus: "accepted",
      }),
    );
  });
});
