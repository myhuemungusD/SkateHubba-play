/**
 * games.updatedAt red-team — proves the April 2026 hardening that pins every
 * write of `games.updatedAt` to `request.time` on the four rule blocks that
 * enforce the 2-second turn-action cooldown:
 *
 *   (1) setting-phase turn update    (player advances setting → matching/setting)
 *   (2) match-resolution update      (matcher reports landed/missed)
 *   (3) dispute-resolution update    (judge on phase=disputable)
 *   (4) Call-BS resolution update    (judge on phase=setReview)
 *
 * Before the fix, the cooldown stanza only compared against the PREVIOUSLY
 * STORED `updatedAt`:
 *
 *   !('updatedAt' in resource.data)
 *   || resource.data.updatedAt == null
 *   || request.time > resource.data.updatedAt + duration.value(2, 's')
 *
 * A malicious client could write `updatedAt: new Date(0)` (or omit the field
 * entirely) on every turn, so the cooldown's `+ 2s` branch was trivially
 * satisfied forever — defeating server-side write flooding protection.
 *
 * Rules now additionally require:
 *
 *   'updatedAt' in request.resource.data
 *   && request.resource.data.updatedAt == request.time
 *
 * Same shape as the `lastSentAt == request.time` guard on notification_limits
 * and `lastNudgedAt == request.time` on nudge_limits. The production service
 * (src/services/games.ts) already writes `updatedAt: serverTimestamp()` on
 * every mutation, so legitimate clients are unaffected.
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

const PROJECT_ID = "demo-skatehubba-rules-games-updatedat-redteam";

const P1_UID = "p1-alice";
const P2_UID = "p2-bob";
const JUDGE_UID = "j-charlie";
const GAME_ID = "g-updatedat";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
// Legitimate, production-shaped future deadline (matches TURN_DURATION_MS).
const validFutureDeadline = () => new Date(Date.now() + TWENTY_FOUR_HOURS_MS);

let testEnv: RulesTestEnvironment;

function asP1(): RulesTestContext {
  return testEnv.authenticatedContext(P1_UID, { email_verified: true });
}

function asP2(): RulesTestContext {
  return testEnv.authenticatedContext(P2_UID, { email_verified: true });
}

function asJudge(): RulesTestContext {
  return testEnv.authenticatedContext(JUDGE_UID, { email_verified: true });
}

function gameRef(ctx: RulesTestContext) {
  return doc(ctx.firestore(), "games", GAME_ID);
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
    turnDeadline: validFutureDeadline(),
    createdAt: serverTimestamp(),
    // Back-date updatedAt so the stored-value cooldown branch (>2s old) passes
    // for every test. The attack cases isolate on the new == request.time
    // guard — they'd sail past the old cooldown alone.
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

describe("games.updatedAt — red-team against stale-timestamp cooldown bypass", () => {
  // (1) Setting-phase turn update — the first `allow update` after create.
  describe("setting-phase turn update", () => {
    it("attack: current-turn player CANNOT advance with a stale (epoch 0) updatedAt", async () => {
      await seedGame({ currentTurn: P1_UID, phase: "setting" });
      await assertFails(
        updateDoc(gameRef(asP1()), {
          phase: "matching",
          currentTrickName: "kickflip",
          currentTrickVideoUrl: "https://example.com/set.webm",
          currentTurn: P2_UID,
          turnDeadline: validFutureDeadline(),
          updatedAt: new Date(0),
        }),
      );
    });

    it("attack: current-turn player CANNOT advance without writing updatedAt at all", async () => {
      // Omitting updatedAt lets the stored-value branch (>2s old) pass, but
      // the new `'updatedAt' in request.resource.data` guard rejects it.
      await seedGame({ currentTurn: P1_UID, phase: "setting" });
      await assertFails(
        updateDoc(gameRef(asP1()), {
          phase: "matching",
          currentTrickName: "kickflip",
          currentTrickVideoUrl: "https://example.com/set.webm",
          currentTurn: P2_UID,
          turnDeadline: validFutureDeadline(),
        }),
      );
    });

    it("legitimate: current-turn player CAN advance setting→matching with serverTimestamp()", async () => {
      await seedGame({ currentTurn: P1_UID, phase: "setting" });
      await assertSucceeds(
        updateDoc(gameRef(asP1()), {
          phase: "matching",
          currentTrickName: "kickflip",
          currentTrickVideoUrl: "https://example.com/set.webm",
          currentTurn: P2_UID,
          turnDeadline: validFutureDeadline(),
          updatedAt: serverTimestamp(),
        }),
      );
    });
  });

  // (2) Match-resolution update — phase == 'matching' branch.
  describe("match-resolution update", () => {
    it("attack: matcher CANNOT submit a missed attempt with a stale updatedAt", async () => {
      await seedGame({
        currentTurn: P2_UID,
        currentSetter: P1_UID,
        phase: "matching",
        currentTrickName: "kickflip",
        currentTrickVideoUrl: "https://example.com/set.webm",
      });
      await assertFails(
        updateDoc(gameRef(asP2()), {
          p2Letters: 1, // matcher admits miss → +1 letter
          phase: "setting",
          currentTurn: P1_UID,
          currentTrickName: null,
          currentTrickVideoUrl: null,
          matchVideoUrl: null,
          turnDeadline: validFutureDeadline(),
          updatedAt: new Date(0),
        }),
      );
    });

    it("attack: matcher CANNOT submit a missed attempt without writing updatedAt", async () => {
      await seedGame({
        currentTurn: P2_UID,
        currentSetter: P1_UID,
        phase: "matching",
        currentTrickName: "kickflip",
        currentTrickVideoUrl: "https://example.com/set.webm",
      });
      await assertFails(
        updateDoc(gameRef(asP2()), {
          p2Letters: 1,
          phase: "setting",
          currentTurn: P1_UID,
          currentTrickName: null,
          currentTrickVideoUrl: null,
          matchVideoUrl: null,
          turnDeadline: validFutureDeadline(),
        }),
      );
    });

    it("legitimate: matcher CAN submit a missed attempt with serverTimestamp()", async () => {
      await seedGame({
        currentTurn: P2_UID,
        currentSetter: P1_UID,
        phase: "matching",
        currentTrickName: "kickflip",
        currentTrickVideoUrl: "https://example.com/set.webm",
      });
      await assertSucceeds(
        updateDoc(gameRef(asP2()), {
          p2Letters: 1,
          phase: "setting",
          currentTurn: P1_UID,
          currentTrickName: null,
          currentTrickVideoUrl: null,
          matchVideoUrl: null,
          turnDeadline: validFutureDeadline(),
          updatedAt: serverTimestamp(),
        }),
      );
    });
  });

  // (3) Dispute-resolution update — judge on phase == 'disputable'.
  describe("dispute-resolution update", () => {
    it("attack: judge CANNOT accept the landed call with a stale updatedAt", async () => {
      await seedGame({
        phase: "disputable",
        currentTurn: JUDGE_UID,
        currentSetter: P1_UID,
        matchVideoUrl: "https://example.com/match.webm",
        judgeId: JUDGE_UID,
        judgeStatus: "accepted",
      });
      await assertFails(
        updateDoc(gameRef(asJudge()), {
          // Accept → letters unchanged, roles swap, phase back to setting.
          phase: "setting",
          currentTurn: P2_UID,
          currentSetter: P2_UID,
          currentTrickName: null,
          currentTrickVideoUrl: null,
          matchVideoUrl: null,
          turnDeadline: validFutureDeadline(),
          updatedAt: new Date(0),
        }),
      );
    });

    it("attack: judge CANNOT accept the landed call without writing updatedAt", async () => {
      await seedGame({
        phase: "disputable",
        currentTurn: JUDGE_UID,
        currentSetter: P1_UID,
        matchVideoUrl: "https://example.com/match.webm",
        judgeId: JUDGE_UID,
        judgeStatus: "accepted",
      });
      await assertFails(
        updateDoc(gameRef(asJudge()), {
          phase: "setting",
          currentTurn: P2_UID,
          currentSetter: P2_UID,
          currentTrickName: null,
          currentTrickVideoUrl: null,
          matchVideoUrl: null,
          turnDeadline: validFutureDeadline(),
        }),
      );
    });

    it("legitimate: judge CAN accept the landed call with serverTimestamp()", async () => {
      await seedGame({
        phase: "disputable",
        currentTurn: JUDGE_UID,
        currentSetter: P1_UID,
        matchVideoUrl: "https://example.com/match.webm",
        judgeId: JUDGE_UID,
        judgeStatus: "accepted",
      });
      await assertSucceeds(
        updateDoc(gameRef(asJudge()), {
          phase: "setting",
          currentTurn: P2_UID,
          currentSetter: P2_UID,
          currentTrickName: null,
          currentTrickVideoUrl: null,
          matchVideoUrl: null,
          turnDeadline: validFutureDeadline(),
          updatedAt: serverTimestamp(),
        }),
      );
    });
  });

  // (4) Call-BS resolution update — judge on phase == 'setReview'.
  describe("Call-BS resolution update", () => {
    it("attack: judge CANNOT rule a set clean with a stale updatedAt", async () => {
      await seedGame({
        phase: "setReview",
        currentTurn: JUDGE_UID,
        currentSetter: P1_UID,
        currentTrickName: "kickflip",
        currentTrickVideoUrl: "https://example.com/set.webm",
        judgeId: JUDGE_UID,
        judgeStatus: "accepted",
      });
      await assertFails(
        updateDoc(gameRef(asJudge()), {
          // Clean → back to matching, matcher must attempt.
          phase: "matching",
          currentTurn: P2_UID,
          turnDeadline: validFutureDeadline(),
          updatedAt: new Date(0),
        }),
      );
    });

    it("attack: judge CANNOT rule a set clean without writing updatedAt", async () => {
      await seedGame({
        phase: "setReview",
        currentTurn: JUDGE_UID,
        currentSetter: P1_UID,
        currentTrickName: "kickflip",
        currentTrickVideoUrl: "https://example.com/set.webm",
        judgeId: JUDGE_UID,
        judgeStatus: "accepted",
      });
      await assertFails(
        updateDoc(gameRef(asJudge()), {
          phase: "matching",
          currentTurn: P2_UID,
          turnDeadline: validFutureDeadline(),
        }),
      );
    });

    it("legitimate: judge CAN rule a set clean with serverTimestamp()", async () => {
      await seedGame({
        phase: "setReview",
        currentTurn: JUDGE_UID,
        currentSetter: P1_UID,
        currentTrickName: "kickflip",
        currentTrickVideoUrl: "https://example.com/set.webm",
        judgeId: JUDGE_UID,
        judgeStatus: "accepted",
      });
      await assertSucceeds(
        updateDoc(gameRef(asJudge()), {
          phase: "matching",
          currentTurn: P2_UID,
          turnDeadline: validFutureDeadline(),
          updatedAt: serverTimestamp(),
        }),
      );
    });
  });
});
