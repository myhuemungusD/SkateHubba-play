/**
 * Games — red-team coverage for three hardening passes added in the
 * comprehensive code review:
 *
 *   1. blocked_users invariant on /games create (firestore.rules:374-375)
 *      A user who blocked, or has been blocked by, the other player must
 *      not be able to create a game with them. Pre-hardening this rule was
 *      live but had zero rules-test coverage — a regression in the rule
 *      would have shipped silently.
 *
 *   2. winner direction pin on /games update completion branches
 *      (firestore.rules match-resolution + dispute-resolution complete
 *      branches). A player whose own letters just hit 5 must NOT be able
 *      to record themselves as winner; the rule now requires
 *      `winner == opponentUid(playerWhoHit5)`.
 *
 *   3. currentTrickVideoUrl scoped to Firebase Storage hosts
 *      (firestore.rules setting→matching branch). Pre-hardening any
 *      `^https?://.+` URL was accepted; a setter could point the matcher's
 *      recorder UI at a malicious origin (referrer leak, NSFW media). The
 *      rule now requires a firebasestorage.googleapis.com or
 *      firebasestorage.app host.
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

const PROJECT_ID = "demo-skatehubba-rules-hardening-redteam";

const P1_UID = "p1-alice";
const P2_UID = "p2-bob";
const GAME_ID = "g-hardening";

const FUTURE_DEADLINE = () => new Date(Date.now() + 24 * 60 * 60 * 1000);
// Must satisfy the bucket+host pin on currentTrickVideoUrl. The rules pin
// to this project's storage bucket (FIREBASE_BUCKET() in firestore.rules);
// any other shape — including legacy fixtures missing the `/v0/b/<bucket>/`
// prefix — is rejected post-hardening.
const VALID_TRICK_URL =
  "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/set.webm";

let testEnv: RulesTestEnvironment;

function asP1(): RulesTestContext {
  return testEnv.authenticatedContext(P1_UID, { email_verified: true });
}

function asP2(): RulesTestContext {
  return testEnv.authenticatedContext(P2_UID, { email_verified: true });
}

function gameRef(ctx: RulesTestContext, id: string = GAME_ID) {
  return doc(ctx.firestore(), "games", id);
}

function makeCreatePayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
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
    judgeId: null,
    judgeStatus: null,
    turnDeadline: FUTURE_DEADLINE(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...extra,
  };
}

function makeMatchingGame(extra: Record<string, unknown> = {}): Record<string, unknown> {
  // P2's turn to attempt the match (P1 set, P2 matches). Built off the
  // create payload so common fields aren't duplicated across helpers.
  return makeCreatePayload({
    p2Letters: 4,
    currentTurn: P2_UID,
    phase: "matching",
    currentTrickName: "kickflip",
    currentTrickVideoUrl: VALID_TRICK_URL,
    turnNumber: 3,
    // Back-date so the 2s turn-action rate limiter passes.
    updatedAt: new Date(Date.now() - 60_000),
    ...extra,
  });
}

async function seedGame(payload: Record<string, unknown>, id: string = GAME_ID): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "games", id), payload);
  });
}

async function seedBlock(blockerUid: string, blockedUid: string): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", blockerUid, "blocked_users", blockedUid), {
      blockedAt: serverTimestamp(),
    });
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

describe("games create — blocked_users invariant", () => {
  it("rejects when challenger has blocked the opponent", async () => {
    await seedBlock(P1_UID, P2_UID);
    await assertFails(setDoc(gameRef(asP1(), "g-blocked-1"), makeCreatePayload()));
  });

  it("rejects when challenger has been blocked by the opponent", async () => {
    await seedBlock(P2_UID, P1_UID);
    await assertFails(setDoc(gameRef(asP1(), "g-blocked-2"), makeCreatePayload()));
  });

  it("permits when neither side has blocked the other", async () => {
    await assertSucceeds(setDoc(gameRef(asP1(), "g-blocked-3"), makeCreatePayload()));
  });
});

describe("games update — winner direction pin (match-resolution complete branch)", () => {
  it("rejects: P2 records themselves as winner after their own 5th letter", async () => {
    await seedGame(makeMatchingGame({ p2Letters: 4 }));
    // P2 (matcher) misses → p2Letters = 5 → game complete. P2 must NOT be the winner.
    await assertFails(
      updateDoc(gameRef(asP2()), {
        p1Letters: 0,
        p2Letters: 5,
        status: "complete",
        phase: "setting",
        currentTurn: P2_UID,
        winner: P2_UID,
        turnDeadline: FUTURE_DEADLINE(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("permits: P2 records P1 as winner after P2's own 5th letter", async () => {
    await seedGame(makeMatchingGame({ p2Letters: 4 }));
    await assertSucceeds(
      updateDoc(gameRef(asP2()), {
        p1Letters: 0,
        p2Letters: 5,
        status: "complete",
        phase: "setting",
        currentTurn: P1_UID,
        winner: P1_UID,
        turnDeadline: FUTURE_DEADLINE(),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe("games update — currentTrickVideoUrl host pin (setting→matching branch)", () => {
  // Seed a P1-owned setting-phase game with a back-dated updatedAt so the 2s
  // turn-action rate limiter passes on the subsequent update.
  async function seedSettingGameOwnedByP1(): Promise<void> {
    await seedGame({
      ...makeCreatePayload({ currentTurn: P1_UID, phase: "setting" }),
      updatedAt: new Date(Date.now() - 60_000),
    });
  }

  // Build a setting→matching update payload with the URL under test.
  function setTrickUpdate(currentTrickVideoUrl: string): Record<string, unknown> {
    return {
      phase: "matching",
      currentTrickName: "kickflip",
      currentTrickVideoUrl,
      currentTurn: P2_UID,
      turnDeadline: FUTURE_DEADLINE(),
      updatedAt: serverTimestamp(),
    };
  }

  it("rejects an arbitrary HTTPS host (referrer/exfil vector)", async () => {
    await seedSettingGameOwnedByP1();
    await assertFails(updateDoc(gameRef(asP1()), setTrickUpdate("https://attacker.example.com/clip.webm")));
  });

  it("rejects http:// even on a Firebase Storage host", async () => {
    await seedSettingGameOwnedByP1();
    await assertFails(
      updateDoc(gameRef(asP1()), setTrickUpdate("http://firebasestorage.googleapis.com/test/clip.webm")),
    );
  });

  it("permits a firebasestorage.googleapis.com URL pinned to this project's bucket", async () => {
    await seedSettingGameOwnedByP1();
    await assertSucceeds(updateDoc(gameRef(asP1()), setTrickUpdate(VALID_TRICK_URL)));
  });

  it("permits the bucket-as-host CDN form pinned to this project's bucket", async () => {
    await seedSettingGameOwnedByP1();
    await assertSucceeds(
      updateDoc(gameRef(asP1()), setTrickUpdate("https://sk8hub-d7806.firebasestorage.app/o/set.webm")),
    );
  });

  it("rejects a firebasestorage.googleapis.com URL pinned to ANOTHER project's bucket", async () => {
    await seedSettingGameOwnedByP1();
    await assertFails(
      updateDoc(
        gameRef(asP1()),
        setTrickUpdate("https://firebasestorage.googleapis.com/v0/b/attacker-project.firebasestorage.app/o/set.webm"),
      ),
    );
  });

  it("rejects the bucket-as-host form pinned to ANOTHER project's bucket", async () => {
    await seedSettingGameOwnedByP1();
    await assertFails(
      updateDoc(gameRef(asP1()), setTrickUpdate("https://attacker-project.firebasestorage.app/o/set.webm")),
    );
  });
});

// ── matchVideoUrl bucket pin (audit P2) ──
// Matcher writes their attempt video as part of the matching-phase
// resolution. Pre-hardening, matchVideoUrl was set with no host check on
// the match-resolution, dispute-resolution, or expired-dispute auto-accept
// branches — a matcher could persist any HTTPS URL, which then flowed
// verbatim into the dispute UI and the public clip feed (referrer/exfil
// vector + content spoof). The pin requires the URL to be unchanged,
// explicit null, or this project's Firebase Storage bucket.
describe("games update — matchVideoUrl bucket pin", () => {
  const VALID_MATCH_URL =
    "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/match.webm";
  const ATTACKER_URL = "https://attacker.com/payload.html";
  const ATTACKER_BUCKET_URL =
    "https://firebasestorage.googleapis.com/v0/b/attacker-project.firebasestorage.app/o/match.webm";

  describe("match-resolution branch (matcher submits landed attempt, honor system)", () => {
    async function seedMatchingPhase(): Promise<void> {
      await seedGame(makeMatchingGame({ p2Letters: 0 }));
    }

    // The matcher submits a landed call. Honor-system path: roles swap,
    // matcher becomes the new currentTurn (== opponentUid(currentSetter)
    // which is P2 in this seed, since currentSetter is P1), letters
    // unchanged, matchVideoUrl carries the recorded attempt.
    function landedPayload(matchVideoUrl: unknown): Record<string, unknown> {
      return {
        p1Letters: 0,
        p2Letters: 0,
        phase: "setting",
        currentTurn: P2_UID,
        matchVideoUrl,
        turnDeadline: FUTURE_DEADLINE(),
        updatedAt: serverTimestamp(),
      };
    }

    it("rejects matcher writing an attacker-hosted matchVideoUrl", async () => {
      await seedMatchingPhase();
      await assertFails(updateDoc(gameRef(asP2()), landedPayload(ATTACKER_URL)));
    });

    it("rejects matcher writing a matchVideoUrl pinned to ANOTHER project's bucket", async () => {
      await seedMatchingPhase();
      await assertFails(updateDoc(gameRef(asP2()), landedPayload(ATTACKER_BUCKET_URL)));
    });

    it("permits matcher writing a matchVideoUrl pinned to this project's bucket", async () => {
      await seedMatchingPhase();
      await assertSucceeds(updateDoc(gameRef(asP2()), landedPayload(VALID_MATCH_URL)));
    });
  });

  describe("dispute-resolution branch (judge rules on disputable phase)", () => {
    const JUDGE_UID = "j-charlie";

    function asJudge(): RulesTestContext {
      return testEnv.authenticatedContext(JUDGE_UID, { email_verified: true });
    }

    async function seedDisputablePhase(extra: Record<string, unknown> = {}): Promise<void> {
      await seedGame(
        makeMatchingGame({
          phase: "disputable",
          currentTurn: JUDGE_UID,
          judgeId: JUDGE_UID,
          judgeStatus: "accepted",
          matchVideoUrl: VALID_MATCH_URL,
          ...extra,
        }),
      );
    }

    // Judge accepts the landed call — phase swaps to setting, letters
    // unchanged. Without the matchVideoUrl pin a judge could overwrite the
    // stored URL with an attacker payload on this transition.
    function acceptPayload(matchVideoUrl: unknown): Record<string, unknown> {
      return {
        p1Letters: 0,
        p2Letters: 4,
        phase: "setting",
        currentTurn: P2_UID,
        matchVideoUrl,
        turnDeadline: FUTURE_DEADLINE(),
        updatedAt: serverTimestamp(),
      };
    }

    it("rejects judge swapping in an attacker-hosted matchVideoUrl", async () => {
      await seedDisputablePhase();
      await assertFails(updateDoc(gameRef(asJudge()), acceptPayload(ATTACKER_URL)));
    });

    it("rejects judge swapping in another project's bucket URL", async () => {
      await seedDisputablePhase();
      await assertFails(updateDoc(gameRef(asJudge()), acceptPayload(ATTACKER_BUCKET_URL)));
    });

    it("permits judge keeping the existing bucket-pinned matchVideoUrl (unchanged path)", async () => {
      await seedDisputablePhase();
      await assertSucceeds(updateDoc(gameRef(asJudge()), acceptPayload(VALID_MATCH_URL)));
    });
  });

  describe("expired-dispute auto-accept branch", () => {
    const JUDGE_UID = "j-charlie";

    async function seedExpiredDisputable(): Promise<void> {
      // turnDeadline expired so any participant can trigger auto-accept.
      await seedGame(
        makeMatchingGame({
          phase: "disputable",
          currentTurn: JUDGE_UID,
          judgeId: JUDGE_UID,
          judgeStatus: "accepted",
          matchVideoUrl: VALID_MATCH_URL,
          turnDeadline: new Date(Date.now() - 60_000),
        }),
      );
    }

    function autoAcceptPayload(matchVideoUrl: unknown): Record<string, unknown> {
      return {
        p1Letters: 0,
        p2Letters: 4,
        phase: "setting",
        currentTurn: P2_UID,
        matchVideoUrl,
        turnDeadline: FUTURE_DEADLINE(),
        updatedAt: serverTimestamp(),
      };
    }

    it("rejects auto-accept that swaps in an attacker-hosted matchVideoUrl", async () => {
      await seedExpiredDisputable();
      await assertFails(updateDoc(gameRef(asP1()), autoAcceptPayload(ATTACKER_URL)));
    });

    it("rejects auto-accept that swaps in another project's bucket URL", async () => {
      await seedExpiredDisputable();
      await assertFails(updateDoc(gameRef(asP1()), autoAcceptPayload(ATTACKER_BUCKET_URL)));
    });

    it("permits auto-accept that leaves the existing bucket-pinned URL in place", async () => {
      await seedExpiredDisputable();
      await assertSucceeds(updateDoc(gameRef(asP1()), autoAcceptPayload(VALID_MATCH_URL)));
    });
  });
});
