/**
 * turnDeadline upper-bound red-team — proves the April 2026 hardening that
 * caps every write of `games.turnDeadline` to `request.time + 48h`.
 *
 * Before the fix, every turnDeadline write path only checked `is timestamp`
 * (plus `> request.time` on the create). A malicious client could set an
 * effectively unbounded future deadline and permanently lock the opponent
 * out of the forfeit path — the forfeit rule requires
 * `request.time > resource.data.turnDeadline`, which would never hold against
 * a year-9999 deadline.
 *
 * NOTE: the original vuln brief mentioned `Timestamp.fromMillis(Number.
 * MAX_SAFE_INTEGER)` as the attack shape, but the Firestore JS SDK rejects
 * that value client-side with "Timestamp seconds out of range". The attack
 * tests below use year 9999 instead — the largest SDK-serialisable timestamp
 * and the most extreme "permanent lockout" shape that can actually reach the
 * rules engine. A rules-layer denial here proves the cap is doing the work.
 *
 * Rules now enforce `turnDeadline < request.time + duration.value(48, 'h')`
 * on every write path that sets a fresh deadline:
 *
 *   (a) /games create
 *   (b) setting-phase turn update
 *   (c) match-resolution update
 *   (d) dispute-resolution update (judge on disputable)
 *   (e) Call-BS resolution update (judge on setReview)
 *   (f) expired-dispute auto-accept
 *   (g) expired-setReview auto-clear
 *
 * Each of these should reject a year-9999 deadline and accept a 24h-ahead
 * deadline (the value the production service actually writes — see
 * src/services/games.ts TURN_DURATION_MS).
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
import { Timestamp, doc, setDoc, updateDoc, serverTimestamp, setLogLevel } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-games-turndeadline-redteam";

const P1_UID = "p1-alice";
const P2_UID = "p2-bob";
const JUDGE_UID = "j-charlie";
const GAME_ID = "g-deadline";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
// A legitimate, production-shaped future deadline.
const validFutureDeadline = () => new Date(Date.now() + TWENTY_FOUR_HOURS_MS);
// Maximum SDK-serialisable Timestamp (year 9999). Without the 48h cap this
// would permanently block the opponent's forfeit path. `Timestamp.fromMillis(
// Number.MAX_SAFE_INTEGER)` is rejected client-side by the SDK, so this is
// the most extreme shape that actually reaches the rules engine.
const farFutureDeadline = () => Timestamp.fromDate(new Date("9999-12-31T23:59:59.999Z"));

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
    // Back-date updatedAt so the 2s turn-action rate limit passes on updates.
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

describe("games.turnDeadline — red-team against unbounded-future lockout", () => {
  // (a) Create path
  describe("create", () => {
    it("attack: create CANNOT use a year-9999 turnDeadline", async () => {
      // Without the 48h cap, this write would succeed and then permanently
      // block the opponent's forfeit path (forfeit requires
      // request.time > resource.data.turnDeadline).
      await assertFails(setDoc(gameRef(asP1()), makeValidGame({ turnDeadline: farFutureDeadline() })));
    });

    it("legitimate: create CAN use a 24h-ahead turnDeadline", async () => {
      await assertSucceeds(setDoc(gameRef(asP1()), makeValidGame({ turnDeadline: validFutureDeadline() })));
    });
  });

  // (b) Setting-phase turn update
  describe("setting-phase turn update", () => {
    it("attack: current-turn player CANNOT set turnDeadline to year 9999", async () => {
      await seedGame({ currentTurn: P1_UID, phase: "setting" });
      await assertFails(
        updateDoc(gameRef(asP1()), {
          phase: "matching",
          currentTrickName: "kickflip",
          currentTrickVideoUrl: "https://firebasestorage.googleapis.com/test/set.webm",
          currentTurn: P2_UID,
          turnDeadline: farFutureDeadline(),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    it("legitimate: current-turn player CAN advance setting→matching with a 24h deadline", async () => {
      await seedGame({ currentTurn: P1_UID, phase: "setting" });
      await assertSucceeds(
        updateDoc(gameRef(asP1()), {
          phase: "matching",
          currentTrickName: "kickflip",
          currentTrickVideoUrl: "https://firebasestorage.googleapis.com/test/set.webm",
          currentTurn: P2_UID,
          turnDeadline: validFutureDeadline(),
          updatedAt: serverTimestamp(),
        }),
      );
    });
  });

  // (c) Match-resolution update (matcher reports landed/missed)
  describe("match-resolution update", () => {
    it("attack: matcher CANNOT set turnDeadline to year 9999 on a missed attempt", async () => {
      // Honor-system game, P2 is matching P1's set and reports missed — must
      // write a fresh deadline for the next setting turn.
      await seedGame({
        currentTurn: P2_UID,
        currentSetter: P1_UID,
        phase: "matching",
        currentTrickName: "kickflip",
        currentTrickVideoUrl: "https://firebasestorage.googleapis.com/test/set.webm",
      });
      await assertFails(
        updateDoc(gameRef(asP2()), {
          p2Letters: 1, // matcher admits miss → +1 letter
          phase: "setting",
          currentTurn: P1_UID,
          currentTrickName: null,
          currentTrickVideoUrl: null,
          matchVideoUrl: null,
          turnDeadline: farFutureDeadline(),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    it("legitimate: matcher CAN submit a missed attempt with a 24h deadline", async () => {
      await seedGame({
        currentTurn: P2_UID,
        currentSetter: P1_UID,
        phase: "matching",
        currentTrickName: "kickflip",
        currentTrickVideoUrl: "https://firebasestorage.googleapis.com/test/set.webm",
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

  // (d) Dispute-resolution update (judge rules on disputable phase)
  describe("dispute-resolution update", () => {
    it("attack: judge CANNOT set turnDeadline to year 9999 when accepting the landed call", async () => {
      await seedGame({
        phase: "disputable",
        currentTurn: JUDGE_UID,
        currentSetter: P1_UID,
        matchVideoUrl: "https://firebasestorage.googleapis.com/test/match.webm",
        judgeId: JUDGE_UID,
        judgeStatus: "accepted",
      });
      await assertFails(
        updateDoc(gameRef(asJudge()), {
          // Accept → no letter change, roles swap, phase back to setting.
          phase: "setting",
          currentTurn: P2_UID, // opponent of setter = new setter
          currentSetter: P2_UID,
          currentTrickName: null,
          currentTrickVideoUrl: null,
          matchVideoUrl: null,
          turnDeadline: farFutureDeadline(),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    it("legitimate: judge CAN accept the landed call with a 24h deadline", async () => {
      await seedGame({
        phase: "disputable",
        currentTurn: JUDGE_UID,
        currentSetter: P1_UID,
        matchVideoUrl: "https://firebasestorage.googleapis.com/test/match.webm",
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

  // (e) Call-BS resolution update (judge rules on setReview phase)
  describe("Call-BS resolution update", () => {
    it("attack: judge CANNOT set turnDeadline to year 9999 when ruling a set clean", async () => {
      await seedGame({
        phase: "setReview",
        currentTurn: JUDGE_UID,
        currentSetter: P1_UID,
        currentTrickName: "kickflip",
        currentTrickVideoUrl: "https://firebasestorage.googleapis.com/test/set.webm",
        judgeId: JUDGE_UID,
        judgeStatus: "accepted",
      });
      await assertFails(
        updateDoc(gameRef(asJudge()), {
          // Clean → back to matching, matcher must attempt.
          phase: "matching",
          currentTurn: P2_UID,
          turnDeadline: farFutureDeadline(),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    it("legitimate: judge CAN rule a set clean with a 24h deadline", async () => {
      await seedGame({
        phase: "setReview",
        currentTurn: JUDGE_UID,
        currentSetter: P1_UID,
        currentTrickName: "kickflip",
        currentTrickVideoUrl: "https://firebasestorage.googleapis.com/test/set.webm",
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

  // (f) Expired dispute auto-accept
  describe("expired dispute auto-accept", () => {
    it("attack: auto-accept CANNOT set turnDeadline to year 9999", async () => {
      // Old turnDeadline has expired — any participant can trigger
      // auto-accept, which writes a fresh turnDeadline that still must be
      // inside the 48h cap.
      await seedGame({
        phase: "disputable",
        currentTurn: JUDGE_UID,
        currentSetter: P1_UID,
        matchVideoUrl: "https://firebasestorage.googleapis.com/test/match.webm",
        judgeId: JUDGE_UID,
        judgeStatus: "accepted",
        turnDeadline: new Date(Date.now() - 60_000),
      });
      await assertFails(
        updateDoc(gameRef(asP1()), {
          phase: "setting",
          currentTurn: P2_UID,
          currentSetter: P2_UID,
          currentTrickName: null,
          currentTrickVideoUrl: null,
          matchVideoUrl: null,
          turnDeadline: farFutureDeadline(),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    it("legitimate: auto-accept CAN set a 24h-ahead turnDeadline", async () => {
      await seedGame({
        phase: "disputable",
        currentTurn: JUDGE_UID,
        currentSetter: P1_UID,
        matchVideoUrl: "https://firebasestorage.googleapis.com/test/match.webm",
        judgeId: JUDGE_UID,
        judgeStatus: "accepted",
        turnDeadline: new Date(Date.now() - 60_000),
      });
      await assertSucceeds(
        updateDoc(gameRef(asP1()), {
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

  // (g) Expired setReview auto-clear
  describe("expired setReview auto-clear", () => {
    it("attack: auto-clear CANNOT set turnDeadline to year 9999", async () => {
      await seedGame({
        phase: "setReview",
        currentTurn: JUDGE_UID,
        currentSetter: P1_UID,
        currentTrickName: "kickflip",
        currentTrickVideoUrl: "https://firebasestorage.googleapis.com/test/set.webm",
        judgeId: JUDGE_UID,
        judgeStatus: "accepted",
        turnDeadline: new Date(Date.now() - 60_000),
      });
      await assertFails(
        updateDoc(gameRef(asP1()), {
          phase: "matching",
          currentTurn: P2_UID,
          turnDeadline: farFutureDeadline(),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    it("legitimate: auto-clear CAN set a 24h-ahead turnDeadline", async () => {
      await seedGame({
        phase: "setReview",
        currentTurn: JUDGE_UID,
        currentSetter: P1_UID,
        currentTrickName: "kickflip",
        currentTrickVideoUrl: "https://firebasestorage.googleapis.com/test/set.webm",
        judgeId: JUDGE_UID,
        judgeStatus: "accepted",
        turnDeadline: new Date(Date.now() - 60_000),
      });
      await assertSucceeds(
        updateDoc(gameRef(asP1()), {
          phase: "matching",
          currentTurn: P2_UID,
          turnDeadline: validFutureDeadline(),
          updatedAt: serverTimestamp(),
        }),
      );
    });
  });
});
