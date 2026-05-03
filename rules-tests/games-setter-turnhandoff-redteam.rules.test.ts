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
// A non-null matchVideoUrl left on the doc by a prior turn's matching-phase
// resolution. Tests 7–12 all exercise the matchVideoUrl-immutable pin against
// this same shared baseline.
const PREV_MATCH_URL = "https://example.com/prev-turn-match.webm";

// Trailing timing fields every legitimate turn-action write carries. The
// turn-action rate limiter requires `updatedAt: serverTimestamp()` and the
// rule clamps `turnDeadline` to a bounded future timestamp.
const commonTimings = () => ({
  turnDeadline: VALID_DEADLINE(),
  updatedAt: serverTimestamp(),
});

// Canonical failSetTrick payload: setter couldn't land → role/currentTurn
// swap to opponent, trick fields clear, turnNumber advances. Whether the
// rule accepts a given call depends solely on the seed's turnNumber (the
// rule pins +1) and the matchVideoUrl-immutable constraint — the payload
// shape itself is invariant. Tests vary the `turnNumber` arg to assert pass
// vs. fail against different seeds.
const failSetWrite = (turnNumber: number) => ({
  phase: "setting" as const,
  currentSetter: P2_UID,
  currentTurn: P2_UID,
  currentTrickName: null,
  currentTrickVideoUrl: null,
  turnNumber,
  ...commonTimings(),
});

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

// Seed: setter is currentTurn/currentSetter on the given turn, phase='setting',
// and the doc carries a previous turn's PREV_MATCH_URL. This is the canonical
// turn-2+ baseline the matchVideoUrl-immutable pin protects.
async function seedSetterWithPriorMatch(setterUid: typeof P1_UID | typeof P2_UID, turnNumber: number): Promise<void> {
  await seedGame({
    currentTurn: setterUid,
    currentSetter: setterUid,
    phase: "setting",
    turnNumber,
    matchVideoUrl: PREV_MATCH_URL,
  });
}

// Seed P1 as setter on turn 3 (the turn-number used by both legitimate
// setTrick and failSetTrick happy-path tests), optionally with a prior
// turn's matchVideoUrl on the doc.
async function seedSetterTurn3(opts: { priorMatch: boolean }): Promise<void> {
  if (opts.priorMatch) {
    await seedSetterWithPriorMatch(P1_UID, 3);
  } else {
    await seedGame({ currentTurn: P1_UID, currentSetter: P1_UID, phase: "setting", turnNumber: 3 });
  }
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
        ...commonTimings(),
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
      updateDoc(gameRef(asP1()), {
        phase: "matching",
        currentTrickName: "kickflip",
        currentTrickVideoUrl: VALID_VIDEO_URL,
        currentTurn: P2_UID,
        // Illegal: match video URL only comes from the matching-phase rule.
        matchVideoUrl: "https://example.com/fake-match.webm",
        ...commonTimings(),
      }),
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
        ...commonTimings(),
      }),
    );
  });

  // Same attack, setting→setting variant — the rule requires strict +1.
  // Seed at turnNumber 5; write the otherwise-legit failSetWrite payload but
  // with turnNumber: 4. The rule rejects because 4 ≠ 5 + 1.
  it("attack: setter CANNOT regress turnNumber during a setting→setting (fail-set) update", async () => {
    await seedGame({ currentTurn: P1_UID, currentSetter: P1_UID, phase: "setting", turnNumber: 5 });
    await assertFails(updateDoc(gameRef(asP1()), failSetWrite(4)));
  });

  // (5) + (9) Legitimate failSetTrick write from src/services/games.ts
  // (setter couldn't land → role passes to opponent, turn+1, trick cleared).
  // Mirrors the production payload exactly — matchVideoUrl is NOT written
  // (the setting-phase rule pins it immutable). Both seed shapes must work:
  //   • no prior matchVideoUrl — vanilla baseline.
  //   • prior matchVideoUrl present — turn-2+ regression. The production
  //     code used to also write `matchVideoUrl: null` here, which the pin
  //     rejects once any prior turn left a real URL on the doc.
  it.each([
    { label: "no prior matchVideoUrl", priorMatch: false },
    { label: "prior matchVideoUrl is non-null", priorMatch: true },
  ])("legitimate: setter CAN fail-set (setting→setting, role flips, turn+1) when $label", async ({ priorMatch }) => {
    await seedSetterTurn3({ priorMatch });
    // Seed turnNumber is 3, so write turnNumber must be 4. The rule's
    // matchVideoUrl pin is satisfied because the payload omits the field.
    await assertSucceeds(updateDoc(gameRef(asP1()), failSetWrite(4)));
  });

  // (6) + (7) + (12) Legitimate setTrick write from src/services/games.ts
  // (setter records a trick → phase 'matching', currentTurn swaps to matcher,
  // turnNumber unchanged, currentSetter unchanged). All three legitimate
  // shapes the matchVideoUrl `==` pin must permit:
  //   • no prior matchVideoUrl, omits the field — vanilla baseline.
  //   • prior matchVideoUrl, omits the field — production turn-2+ payload.
  //     Regression of the original bug where setTrick wrote `matchVideoUrl:
  //     null`, which the pin rejects once any prior turn left a real URL.
  //   • prior matchVideoUrl, re-writes the same value — idempotency for
  //     resumable transactions. Guards against a future strict rewrite
  //     (e.g. !('matchVideoUrl' in resource.data)) breaking legit retries.
  it.each([
    { label: "no prior matchVideoUrl (vanilla)", priorMatch: false, patch: {} as Record<string, unknown> },
    {
      label: "prior matchVideoUrl, omits the field (production setTrick payload)",
      priorMatch: true,
      patch: {} as Record<string, unknown>,
    },
    {
      label: "prior matchVideoUrl, explicitly re-writes the same value",
      priorMatch: true,
      patch: { matchVideoUrl: PREV_MATCH_URL } as Record<string, unknown>,
    },
  ])(
    "legitimate: setter CAN set a trick (setting→matching, role stays, turn unchanged) — $label",
    async ({ priorMatch, patch }) => {
      await seedSetterTurn3({ priorMatch });
      await assertSucceeds(
        updateDoc(gameRef(asP1()), {
          phase: "matching",
          currentTrickName: "kickflip",
          currentTrickVideoUrl: VALID_VIDEO_URL,
          currentTurn: P2_UID,
          ...patch,
          ...commonTimings(),
        }),
      );
    },
  );

  // (8) + (11) Both shapes the matchVideoUrl `==` pin must reject:
  //   • clear-to-null  — locks in the contract that a future refactor
  //                      reintroducing `matchVideoUrl: null` on setTrick
  //                      surfaces the regression before users hit it mid-game.
  //   • swap-to-forged — the original anti-stash exploit shape; the pin must
  //                      reject ANY change, not just null-clearing.
  // Parametrized so the seed + write live once; only the illegal value differs.
  it.each([
    { label: "clear a non-null matchVideoUrl to null", illegal: null },
    {
      label: "swap a non-null matchVideoUrl for a different non-null URL",
      illegal: "https://example.com/forged-match.webm",
    },
  ] as const)("attack: setter CANNOT $label during setting→matching", async ({ illegal }) => {
    await seedSetterWithPriorMatch(P1_UID, 2);
    await assertFails(
      updateDoc(gameRef(asP1()), {
        phase: "matching",
        currentTrickName: "kickflip",
        currentTrickVideoUrl: VALID_VIDEO_URL,
        currentTurn: P2_UID,
        matchVideoUrl: illegal,
        ...commonTimings(),
      }),
    );
  });

  // (10) Mirror of (7): P2 setter on an even-numbered turn with non-null
  // matchVideoUrl. Both setters drive `setTrick`, so both sides need
  // explicit coverage — without it a future rule that branched on uid
  // could break one side silently.
  it("legitimate: P2 setter CAN set a trick when prior matchVideoUrl is non-null", async () => {
    await seedSetterWithPriorMatch(P2_UID, 4);
    await assertSucceeds(
      updateDoc(gameRef(asP2()), {
        phase: "matching",
        currentTrickName: "heelflip",
        currentTrickVideoUrl: VALID_VIDEO_URL,
        currentTurn: P1_UID,
        ...commonTimings(),
      }),
    );
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
