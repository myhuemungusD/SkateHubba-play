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

// matchVideoUrl must be pinned to THIS project's Firebase Storage bucket
// (audit-P2 bucket pin in firestore.rules). The legitimate match-resolution
// writes below carry a recorded attempt video, so they use a bucket-pinned
// URL — otherwise the pin (correctly) rejects them for a reason unrelated to
// the turn-order invariant each test is actually exercising.
const VALID_MATCH_URL =
  "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/match.webm";

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
        // Bucket-pinned per audit-P2 host pin on currentTrickVideoUrl.
        currentTrickVideoUrl:
          "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/set.webm",
        currentTurn: P2_UID,
        turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

/* ────────────────────────────────────────────
 * P0 — match-resolution turn-order seize guard
 *
 * The matching→* resolution branch is the ONLY game-update branch that
 * historically pinned neither currentSetter nor turnNumber. A matcher could
 * submit a legitimate-looking "missed" resolution and in the SAME write
 * grab currentSetter/currentTurn for themselves, jumping the setter role
 * out of rotation. The pins added to firestore.rules close this:
 *   • missed-continues  → currentSetter UNCHANGED, turnNumber + 1
 *   • completion        → currentSetter + turnNumber UNCHANGED
 *   • honor + landed    → currentSetter ROTATES to matcher, turnNumber + 1
 *   • judge disputable  → currentSetter + turnNumber UNCHANGED
 *
 * Fixture: currentSetter = P1, phase = matching, currentTurn = P2. So P2 is
 * the matcher and any attempt by P2 to seize the setter role is the attack.
 * ──────────────────────────────────────────── */
describe("games — P0 match-resolution turn-order seize guard", () => {
  it("attack: matcher submits MISSED but seizes currentSetter/currentTurn", async () => {
    // P2 (matcher) admits a miss — legitimately p2Letters + 1, currentSetter
    // must stay P1, turnNumber → 2. Here P2 forges currentSetter = P2 (and
    // currentTurn = P2) to grab the setter role out of rotation.
    await seedGame({ currentTurn: P2_UID, phase: "matching", currentSetter: P1_UID });
    await assertFails(
      updateDoc(doc(asP2().firestore(), "games", GAME_ID), {
        phase: "setting",
        p2Letters: 1,
        currentSetter: P2_UID, // SEIZE — should be unchanged (P1) on a miss
        currentTurn: P2_UID,
        turnNumber: 2,
        turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("attack: matcher submits MISSED but freezes turnNumber (no advance)", async () => {
    // turnNumber MUST advance by exactly 1 on a missed-continues resolution.
    // Leaving it pinned (or jumping it) is rejected by the new constraint.
    await seedGame({ currentTurn: P2_UID, phase: "matching", currentSetter: P1_UID, turnNumber: 3 });
    await assertFails(
      updateDoc(doc(asP2().firestore(), "games", GAME_ID), {
        phase: "setting",
        p2Letters: 1,
        currentSetter: P1_UID,
        currentTurn: P1_UID,
        turnNumber: 3, // FROZEN — must be 4
        turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("attack: matcher submits LANDED (honor) rotating setter but freezing turnNumber", async () => {
    // Honor-system landed MUST advance turnNumber by 1 alongside the role
    // rotation. Here P2 rotates currentSetter to itself (the seize) but
    // freezes turnNumber at the stored value — neither the honor+landed
    // branch (needs turnNumber + 1) nor the missed branch (needs
    // currentSetter unchanged) matches, so the write must be rejected.
    await seedGame({ currentTurn: P2_UID, phase: "matching", currentSetter: P1_UID, turnNumber: 4 });
    await assertFails(
      updateDoc(doc(asP2().firestore(), "games", GAME_ID), {
        phase: "setting",
        currentSetter: P2_UID, // rotated (seize), but…
        currentTurn: P2_UID,
        turnNumber: 4, // …FROZEN — honor+landed requires turnNumber + 1
        turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("attack: matcher MISSED (continues) seizes currentTurn to self while pinning setter", async () => {
    // The seize hole the prior commit missed: missed-continues pins
    // currentSetter (P1) + turnNumber, but currentTurn was only required to be
    // one of the two players. P2 keeps currentSetter = P1 (so the setter pin
    // passes) yet writes currentTurn = P2 — because the setting-phase rule
    // authorizes the next update by resource.data.currentTurn, P2 would then
    // be able to perform the legitimate setter's next setting write. The fix
    // pins currentTurn == currentSetter on the missed-continues arm, so this
    // write must be rejected BECAUSE of the currentTurn seize — every other
    // field is the valid missed-continues baseline.
    await seedGame({ currentTurn: P2_UID, phase: "matching", currentSetter: P1_UID });
    await assertFails(
      updateDoc(doc(asP2().firestore(), "games", GAME_ID), {
        phase: "setting",
        p2Letters: 1,
        currentSetter: P1_UID, // setter pin satisfied…
        currentTurn: P2_UID, // …but currentTurn seized to the matcher
        turnNumber: 2,
        turnHistory: [{ turnNumber: 1, landed: false, letterTo: P2_UID }],
        matchVideoUrl: VALID_MATCH_URL,
        turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("legitimate: matcher MISSED ends game (gameOver) with currentTurn unchanged", async () => {
    // submitMatchAttempt missed-gameOver (games.match.ts 312-314): writes only
    // status:"complete", winner, letters, turnHistory, matchVideoUrl,
    // updatedAt — it does NOT touch phase/currentSetter/currentTurn/turnNumber,
    // so all stay unchanged. Seed p2Letters at 4 so the +1 hits 5 and the
    // opponent (P1) wins. currentTurn stays P2 (matcher) — valid because the
    // game is over and no further setting write follows.
    await seedGame({
      currentTurn: P2_UID,
      phase: "matching",
      currentSetter: P1_UID,
      p2Letters: 4,
      turnNumber: 7,
    });
    await assertSucceeds(
      updateDoc(doc(asP2().firestore(), "games", GAME_ID), {
        status: "complete",
        winner: P1_UID,
        p2Letters: 5,
        turnHistory: [{ turnNumber: 7, landed: false, letterTo: P2_UID }],
        matchVideoUrl: VALID_MATCH_URL,
        turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("attack: matcher MISSED ends game (gameOver) but seizes currentSetter", async () => {
    // Same legitimate gameOver completion write as the positive above
    // (games.match.ts 286-314): status:"complete", winner, +1 letter to 5,
    // turnHistory, matchVideoUrl, updatedAt — completion does NOT touch
    // currentSetter/turnNumber/currentTurn/phase. Here P2 ALSO forges
    // currentSetter = P2 to grab the setter role on the way out. The
    // completion arm pins currentSetter UNCHANGED, so the write must be
    // rejected BECAUSE of the currentSetter mutation — every other field is
    // the valid completion baseline.
    await seedGame({
      currentTurn: P2_UID,
      phase: "matching",
      currentSetter: P1_UID,
      p2Letters: 4,
      turnNumber: 7,
    });
    await assertFails(
      updateDoc(doc(asP2().firestore(), "games", GAME_ID), {
        status: "complete",
        winner: P1_UID,
        p2Letters: 5,
        currentSetter: P2_UID, // SEIZE — must stay P1 on completion
        turnHistory: [{ turnNumber: 7, landed: false, letterTo: P2_UID }],
        matchVideoUrl: VALID_MATCH_URL,
        turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("legitimate: matcher MISSED keeps setter, advances turnNumber by 1", async () => {
    // submitMatchAttempt missed-continues (games.match.ts 315-321):
    // currentSetter unchanged, currentTurn = currentSetter, turnNumber + 1.
    await seedGame({ currentTurn: P2_UID, phase: "matching", currentSetter: P1_UID });
    await assertSucceeds(
      updateDoc(doc(asP2().firestore(), "games", GAME_ID), {
        phase: "setting",
        p2Letters: 1,
        currentSetter: P1_UID,
        currentTurn: P1_UID,
        turnNumber: 2,
        turnHistory: [{ turnNumber: 1, landed: false, letterTo: P2_UID }],
        matchVideoUrl: VALID_MATCH_URL,
        turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("legitimate: matcher LANDED (honor) rotates setter to matcher, advances turnNumber", async () => {
    // submitMatchAttempt honor+landed (games.match.ts 222-233): roles swap —
    // currentSetter → matcher (P2), currentTurn follows, turnNumber + 1,
    // letters unchanged.
    await seedGame({ currentTurn: P2_UID, phase: "matching", currentSetter: P1_UID });
    await assertSucceeds(
      updateDoc(doc(asP2().firestore(), "games", GAME_ID), {
        phase: "setting",
        currentSetter: P2_UID,
        currentTurn: P2_UID,
        turnNumber: 2,
        turnHistory: [{ turnNumber: 1, landed: true, letterTo: null }],
        matchVideoUrl: VALID_MATCH_URL,
        turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

/* ────────────────────────────────────────────
 * P0 — judge-routing seize guard (NEW)
 *
 * The two judge-routing outcomes are now merged into one OR branch in
 * firestore.rules (matching-phase update, ~926-935): both landed→disputable
 * and Call BS→setReview pin currentSetter + turnNumber UNCHANGED (the judge's
 * later ruling — not this routing write — advances them) and route
 * currentTurn to the judge. The earlier seize tests cover only the missed and
 * honor+landed outcomes; these close the judge branch.
 *
 * Fixture: an active judge (judgeId = JUDGE_UID, judgeStatus accepted),
 * currentSetter = P1, phase = matching, currentTurn = P2. So P2 is the matcher
 * routing to the judge, and any attempt to also touch currentSetter/turnNumber
 * in that same routing write is the attack.
 * ──────────────────────────────────────────── */
describe("games — P0 judge-routing turn-order seize guard", () => {
  const JUDGE_UID = "j-judge";

  function seedJudgedMatch(extra: Record<string, unknown> = {}): Promise<void> {
    return seedGame({
      currentTurn: P2_UID,
      phase: "matching",
      currentSetter: P1_UID,
      judgeId: JUDGE_UID,
      judgeStatus: "accepted",
      ...extra,
    });
  }

  it("legitimate: matcher routes LANDED→disputable, pins currentSetter + turnNumber", async () => {
    // submitMatchAttempt judge-active landed (games.match.ts 169-176):
    // phase → disputable, currentTurn → judge, currentSetter + turnNumber
    // UNCHANGED, letters unchanged, judgeReviewFor → matcher.
    await seedJudgedMatch({ turnNumber: 3 });
    await assertSucceeds(
      updateDoc(doc(asP2().firestore(), "games", GAME_ID), {
        phase: "disputable",
        matchVideoUrl: VALID_MATCH_URL,
        currentTurn: JUDGE_UID,
        currentSetter: P1_UID, // UNCHANGED
        turnNumber: 3, // UNCHANGED
        judgeReviewFor: P2_UID,
        turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("attack: matcher routes LANDED→disputable but seizes currentSetter", async () => {
    // Same legit disputable routing write as above, but P2 also rotates
    // currentSetter to itself. The judge branch pins currentSetter UNCHANGED
    // (== resource.data.currentSetter), so the write must be rejected BECAUSE
    // of the currentSetter mutation — every other field is the valid baseline.
    await seedJudgedMatch({ turnNumber: 3 });
    await assertFails(
      updateDoc(doc(asP2().firestore(), "games", GAME_ID), {
        phase: "disputable",
        matchVideoUrl: VALID_MATCH_URL,
        currentTurn: JUDGE_UID,
        currentSetter: P2_UID, // SEIZE — must stay P1 on a judge-routing write
        turnNumber: 3,
        judgeReviewFor: P2_UID,
        turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("legitimate: matcher routes Call BS→setReview, pins currentSetter + turnNumber", async () => {
    // callBSOnSetTrick (games.judge.ts 45-51): phase → setReview, currentTurn
    // → judge, judgeReviewFor → setter (currentSetter, P1), currentSetter +
    // turnNumber UNCHANGED, letters unchanged. This is the missing positive
    // proving the merged judge OR branch accepts a VALID setReview routing
    // write (the existing setReview case only tested the attack).
    await seedJudgedMatch({ turnNumber: 5 });
    await assertSucceeds(
      updateDoc(doc(asP2().firestore(), "games", GAME_ID), {
        phase: "setReview",
        currentTurn: JUDGE_UID,
        currentSetter: P1_UID, // UNCHANGED
        turnNumber: 5, // UNCHANGED
        judgeReviewFor: P1_UID,
        turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("attack: matcher routes Call BS→setReview but bumps turnNumber", async () => {
    // callBSOnSetTrick (games.judge.ts 45-51): phase → setReview, currentTurn
    // → judge, judgeReviewFor → setter, currentSetter + turnNumber UNCHANGED,
    // letters unchanged. Here P2 bumps turnNumber, which the judge branch pins
    // (== resource.data.turnNumber). The write must fail BECAUSE of the
    // turnNumber bump — every other field matches the valid setReview baseline.
    await seedJudgedMatch({ turnNumber: 5 });
    await assertFails(
      updateDoc(doc(asP2().firestore(), "games", GAME_ID), {
        phase: "setReview",
        currentTurn: JUDGE_UID,
        currentSetter: P1_UID,
        turnNumber: 6, // BUMP — must stay 5 on a judge-routing write
        judgeReviewFor: P1_UID,
        turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});
