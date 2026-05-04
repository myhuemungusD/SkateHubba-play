/**
 * Games — red-team guards on the setting-phase update branch against the
 * "setter turn-handoff forfeit" exploit.
 *
 * Before the April 2026 hardening, the setting-phase `allow update` block
 * (firestore.rules:339-409) did not pin `currentSetter`, `turnNumber`,
 * `currentTrickName`, `currentTrickVideoUrl`, or `matchVideoUrl`. A setter
 * whose `currentTurn == uid` could therefore write a single update like:
 *
 *   { currentTurn: opponent, currentSetter: opponent,
 *     turnDeadline: request.time + 2s }
 *
 * and every remaining constraint in the rule would still pass (letters
 * unchanged, status/winner unchanged, phase still 'setting', currentTurn
 * is one of the two players, turnDeadline is a bounded future timestamp).
 *
 * 2 seconds later the turnDeadline has expired and the attacker invokes
 * the forfeit branch (firestore.rules:666-694): the opponent "timed out",
 * winner is the opponent's opponent (= the attacker), game over. The
 * opponent never had a chance to act.
 *
 * The hardening pins per transition:
 *   setting → matching
 *     • currentSetter unchanged (role stays with the setter until the match resolves)
 *     • turnNumber unchanged (phase change within the same turn)
 *     • currentTurn swaps to the matcher (opponent of currentSetter)
 *     • currentTrickName/Url required and well-shaped (non-empty/http URL)
 *   setting → setting (fail-set)
 *     • currentSetter MUST flip to the opponent (the point of failSetTrick)
 *     • currentTurn follows currentSetter (new setter's turn)
 *     • turnNumber strictly increments
 *     • trick fields reset to null
 *   both
 *     • matchVideoUrl immutable (it's only written by the matching-phase rule)
 *
 * Each numbered test below corresponds to an attack permutation blocked by
 * one of those pins. The two "legitimate" tests cover the happy paths used
 * by `setTrick` and `failSetTrick` in src/services/games.ts.
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

const PROJECT_ID = "demo-skatehubba-rules-setter-turnhandoff-redteam";

const P1_UID = "p1-alice";
const P2_UID = "p2-bob";
const GAME_ID = "g-setter";

const VALID_DEADLINE = () => new Date(Date.now() + 24 * 60 * 60 * 1000);
const VALID_VIDEO_URL = "https://example.com/set.webm";
// Sentinel value the matching-phase rule writes; any prior turn leaves this on
// the doc, so every turn-2+ setting-phase write must coexist with it. Used by
// the matchVideoUrl-immutability tests below.
const PREV_MATCH_URL = "https://example.com/prev-turn-match.webm";

// Canonical setting→matching payload (setter records a trick). Spread `extra`
// to override/add fields — e.g. `setTrickPayload({ matchVideoUrl: null })` for
// the attack tests that try to clobber the matchVideoUrl pin.
function setTrickPayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    phase: "matching",
    currentTrickName: "kickflip",
    currentTrickVideoUrl: VALID_VIDEO_URL,
    currentTurn: P2_UID,
    turnDeadline: VALID_DEADLINE(),
    updatedAt: serverTimestamp(),
    ...extra,
  };
}

// Canonical setting→setting payload (failSetTrick — role and turn flip from P1
// to P2, trick fields cleared). `turnNumber` defaults to 4 (matches the legit
// turn-3→4 happy path); override for regression tests.
function failSetPayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    phase: "setting",
    currentSetter: P2_UID,
    currentTurn: P2_UID,
    currentTrickName: null,
    currentTrickVideoUrl: null,
    turnNumber: 4,
    turnDeadline: VALID_DEADLINE(),
    updatedAt: serverTimestamp(),
    ...extra,
  };
}

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

function makeActiveGame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    player1Uid: P1_UID,
    player2Uid: P2_UID,
    player1Username: "alice",
    player2Username: "bob",
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    // P1 is the current setter and it's their turn by default.
    currentTurn: P1_UID,
    phase: "setting",
    currentSetter: P1_UID,
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnNumber: 1,
    winner: null,
    turnHistory: [],
    turnDeadline: VALID_DEADLINE(),
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

// Seed a P1-setter, setting-phase game with a non-null prior matchVideoUrl —
// the shape every turn-2+ game has. Used by tests #7, #8, #11, #12.
async function seedP1SettingWithPriorMatch(turnNumber: number): Promise<void> {
  return seedGame({
    currentTurn: P1_UID,
    currentSetter: P1_UID,
    phase: "setting",
    turnNumber,
    matchVideoUrl: PREV_MATCH_URL,
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

describe("games — setter turn-handoff forfeit exploit guards", () => {
  // (1) The canonical exploit: setter hands off currentTurn AND currentSetter
  // to the opponent while keeping phase='setting', without incrementing
  // turnNumber. Combined with a short turnDeadline this lets the setter
  // immediately forfeit the opponent. The setting→setting branch now
  // requires turnNumber == resource.data.turnNumber + 1, so this fails.
  it("attack: setter CANNOT hand off currentTurn+currentSetter without incrementing turnNumber", async () => {
    await seedGame({ currentTurn: P1_UID, currentSetter: P1_UID, phase: "setting", turnNumber: 1 });
    await assertFails(
      updateDoc(gameRef(asP1()), {
        // phase stays 'setting' — the exploit branch
        phase: "setting",
        currentTurn: P2_UID,
        currentSetter: P2_UID,
        // turnNumber NOT incremented (1 → 1)
        turnNumber: 1,
        // A 2s deadline so the attacker could forfeit the opponent seconds later.
        turnDeadline: new Date(Date.now() + 2_000),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  // (2) setting→matching must not re-assign currentSetter. The role only
  // changes at match resolution (honor: landed → matcher becomes setter)
  // or fail-set (setting→setting). If the setter could flip currentSetter
  // mid-set, they could later forge a matching-phase state where the
  // "opponent" they framed is now the current setter.
  it("attack: setter CANNOT rewrite currentSetter during setting→matching", async () => {
    await seedGame({ currentTurn: P1_UID, currentSetter: P1_UID, phase: "setting" });
    await assertFails(
      updateDoc(gameRef(asP1()), {
        phase: "matching",
        currentTrickName: "kickflip",
        currentTrickVideoUrl: VALID_VIDEO_URL,
        currentTurn: P2_UID,
        // Illegal: role changes hands even though the match hasn't resolved.
        currentSetter: P2_UID,
        turnDeadline: VALID_DEADLINE(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  // (3) matchVideoUrl is written only by the matching-phase update branch.
  // A setter sneaking a URL in during a setting-phase update could stash a
  // fake "matched" clip and then exploit downstream matching→setting flows
  // against it. The new rule pins matchVideoUrl to its stored value across
  // both setting-phase sub-branches.
  it("attack: setter CANNOT set matchVideoUrl during a setting-phase update", async () => {
    await seedGame({ currentTurn: P1_UID, currentSetter: P1_UID, phase: "setting", matchVideoUrl: null });
    await assertFails(
      // Illegal: match video URL only comes from the matching-phase rule.
      updateDoc(gameRef(asP1()), setTrickPayload({ matchVideoUrl: "https://example.com/fake-match.webm" })),
    );
  });

  // (4) turnNumber must never decrease. Regressing the counter would let
  // a setter rewind history (for instance, clobbering an earlier turn's
  // record by replaying a new setTrick with the same turnNumber → arrayUnion
  // de-dupes). Both sub-branches of the setting-phase rule now pin
  // turnNumber: unchanged for setting→matching, +1 for setting→setting.
  it("attack: setter CANNOT regress turnNumber during a setting→matching update", async () => {
    await seedGame({ currentTurn: P1_UID, currentSetter: P1_UID, phase: "setting", turnNumber: 5 });
    await assertFails(
      updateDoc(gameRef(asP1()), {
        phase: "matching",
        currentTrickName: "kickflip",
        currentTrickVideoUrl: VALID_VIDEO_URL,
        currentTurn: P2_UID,
        // Illegal: 5 → 4.
        turnNumber: 4,
        turnDeadline: VALID_DEADLINE(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  // Same attack, setting→setting variant — the rule requires strict +1.
  it("attack: setter CANNOT regress turnNumber during a setting→setting (fail-set) update", async () => {
    await seedGame({ currentTurn: P1_UID, currentSetter: P1_UID, phase: "setting", turnNumber: 5 });
    // Legit fail-set swaps setter and currentTurn, but here turnNumber regresses 5→4.
    await assertFails(updateDoc(gameRef(asP1()), failSetPayload({ turnNumber: 4 })));
  });

  // (5) Happy path: legitimate failSetTrick write from src/services/games.ts
  // (setter couldn't land → role passes to opponent, turn+1, trick cleared).
  // Mirrors the production payload exactly — matchVideoUrl is NOT written
  // (the setting-phase rule pins it immutable; see test (9) for the
  // turn-2+ regression that locks this contract in).
  it("legitimate: setter CAN fail-set (setting→setting, role flips, turn+1)", async () => {
    await seedGame({ currentTurn: P1_UID, currentSetter: P1_UID, phase: "setting", turnNumber: 3 });
    await assertSucceeds(updateDoc(gameRef(asP1()), failSetPayload()));
  });

  // (6) Happy path: legitimate setTrick write from src/services/games.ts
  // (setter records a trick → phase 'matching', currentTurn swaps to matcher,
  // turnNumber unchanged, currentSetter unchanged).
  it("legitimate: setter CAN set a trick (setting→matching, role stays, turn unchanged)", async () => {
    await seedGame({ currentTurn: P1_UID, currentSetter: P1_UID, phase: "setting", turnNumber: 3 });
    await assertSucceeds(updateDoc(gameRef(asP1()), setTrickPayload()));
  });

  // (7) Regression: turn-2+ setTrick must succeed when the game doc still
  // carries the previous turn's matchVideoUrl. The matchVideoUrl-immutable
  // pin (anti-stash hardening) was correct in spirit but the production
  // setTrick used to also write `matchVideoUrl: null` on every set, which
  // is permission-denied once any prior turn left a real URL on the doc.
  // The fix dropped the field from setTrick's update; this test guards it.
  it("legitimate: setter CAN set a trick when previous turn's matchVideoUrl is non-null", async () => {
    // The previous matcher landed and the matching-phase rule wrote a real URL
    // into the doc — this is what every turn-2+ game looks like. The payload
    // intentionally omits matchVideoUrl: the rule pins it immutable.
    await seedP1SettingWithPriorMatch(2);
    await assertSucceeds(updateDoc(gameRef(asP1()), setTrickPayload()));
  });

  // (8) Regression sibling: the SAME write WITH `matchVideoUrl: null` must
  // be rejected. This locks in the contract — if a future refactor reintroduces
  // the field on setTrick, this test will fail and surface the regression
  // before it reaches users mid-game.
  it("attack: setter CANNOT clear a non-null matchVideoUrl during setting→matching", async () => {
    await seedP1SettingWithPriorMatch(2);
    // Illegal: the setter must not be able to wipe the previous turn's
    // match URL — only the matching-phase rule writes this field.
    await assertFails(updateDoc(gameRef(asP1()), setTrickPayload({ matchVideoUrl: null })));
  });

  // (9) Regression: failSetTrick (setting→setting role swap) must also work
  // when the doc carries a previous turn's matchVideoUrl. Same root cause
  // as (7): the production code used to write `matchVideoUrl: null` here too.
  it("legitimate: setter CAN fail-set when previous turn's matchVideoUrl is non-null", async () => {
    // matchVideoUrl intentionally omitted — pinned immutable across setting phase.
    await seedP1SettingWithPriorMatch(3);
    await assertSucceeds(updateDoc(gameRef(asP1()), failSetPayload()));
  });

  // (10) Mirror of (7): P2 setter on an even-numbered turn with non-null
  // matchVideoUrl. Both setters drive `setTrick`, so both sides need
  // explicit coverage — without it a future rule that branched on uid
  // could break one side silently.
  it("legitimate: P2 setter CAN set a trick when prior matchVideoUrl is non-null", async () => {
    await seedGame({
      currentTurn: P2_UID,
      currentSetter: P2_UID,
      phase: "setting",
      turnNumber: 4,
      matchVideoUrl: PREV_MATCH_URL,
    });
    await assertSucceeds(
      updateDoc(
        gameRef(asP2()),
        // P2-side mirror: drives setTrick from the other setter, with a
        // distinct trick name so this block doesn't twin the P1 payload.
        setTrickPayload({ currentTurn: P1_UID, currentTrickName: "heelflip" }),
      ),
    );
  });

  // (11) Anti-stash variant: setter writes matchVideoUrl to a DIFFERENT
  // non-null URL. The `==` pin must reject any change, not just null-clearing
  // — this is the original exploit shape the rule was added to block.
  it("attack: setter CANNOT swap a non-null matchVideoUrl for a different non-null URL", async () => {
    await seedP1SettingWithPriorMatch(2);
    // Illegal: a forged URL must be rejected the same as null-clearing.
    await assertFails(
      updateDoc(gameRef(asP1()), setTrickPayload({ matchVideoUrl: "https://example.com/forged-match.webm" })),
    );
  });

  // (12) Idempotency: writing the EXACT same non-null URL must pass the
  // `==` pin. Guards against a future strict rewrite (e.g. !('matchVideoUrl'
  // in request.resource.data)) that would break legitimate retries on
  // resumable transactions.
  it("legitimate: setter MAY explicitly re-write the same non-null matchVideoUrl", async () => {
    await seedP1SettingWithPriorMatch(2);
    await assertSucceeds(updateDoc(gameRef(asP1()), setTrickPayload({ matchVideoUrl: PREV_MATCH_URL })));
  });

  // Also prove the attack path is really about the MISSING invariants, not
  // about the attacker being a non-player: drive the canonical attack from
  // P2's account when currentTurn starts on P2 and phase='setting' (i.e.
  // P2 is a legitimate setter in their own turn). The same pins should
  // still block the forged hand-off.
  it("attack: same exploit from the other setter's side is equally rejected", async () => {
    await seedGame({ currentTurn: P2_UID, currentSetter: P2_UID, phase: "setting", turnNumber: 2 });
    await assertFails(
      updateDoc(gameRef(asP2()), {
        phase: "setting",
        currentTurn: P1_UID,
        currentSetter: P1_UID,
        turnNumber: 2, // not incremented
        turnDeadline: new Date(Date.now() + 2_000),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});
