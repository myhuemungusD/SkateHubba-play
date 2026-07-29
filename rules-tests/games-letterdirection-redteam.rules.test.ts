/**
 * Games — red-team guards on the LETTER-AWARD DIRECTION in the two
 * resolution branches that hand out a letter:
 *
 *   1. Match resolution (matcher submits a "missed" attempt). The +1 letter
 *      MUST land on the matcher (== resource.data.currentTurn). A losing
 *      matcher must NOT be able to assign their missed letter to the opponent
 *      and, via the completion branch, forge a win. (audit CRITICAL)
 *
 *   2. Judge dispute resolution (overrule). The +1 letter MUST land on the
 *      disputed turn's matcher (== opponentUid(currentSetter)). A colluding
 *      judge must NOT be able to pile a letter onto the setter (a targeted
 *      player). (audit HIGH)
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { updateDoc, serverTimestamp } from "firebase/firestore";
import { setupRulesTestEnv, seedGameForUpdate, authedContext, gameDoc, activeSettingUpdate } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-games-letterdirection-redteam";

const P1_UID = "p1-alice";
const P2_UID = "p2-bob";
const JUDGE_UID = "j-charlie";
const GAME_ID = "g-letters";

// matchVideoUrl must be pinned to THIS project's bucket (audit-P2 pin).
const VALID_MATCH_URL = "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/match.webm";

const getEnv = setupRulesTestEnv(PROJECT_ID);

const future = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

describe("games — match resolution letter direction (win forgery)", () => {
  // Fixture: currentSetter = P1, phase = matching, currentTurn = P2 (P2 is the
  // matcher), turnNumber 7. Only p1Letters varies between the two cases — 4 puts
  // P1 on match point for the win-forge attack, 0 for the benign continue case.
  const seedMatching = (p1Letters: number) =>
    seedGameForUpdate(
      getEnv(),
      GAME_ID,
      { player1Uid: P1_UID, player2Uid: P2_UID },
      { currentTurn: P2_UID, phase: "matching", currentSetter: P1_UID, p1Letters, p2Letters: 0, turnNumber: 7 },
    );

  it("attack: matcher (P2) assigns the missed letter to the OPPONENT (P1) to forge a P2 win", async () => {
    await seedMatching(4); // P1 on match point
    // P2 pushes P1 to the 5th letter and records P2 as the winner. The +1 is
    // bound to currentTurn (P2), so a p1Letters increment must be rejected —
    // completion baseline (currentSetter/turnNumber unchanged) is otherwise met.
    await assertFails(
      updateDoc(gameDoc(authedContext(getEnv(), P2_UID), GAME_ID), {
        status: "complete",
        winner: P2_UID,
        p1Letters: 5, // FORGED — matcher hands the letter to the opponent
        currentSetter: P1_UID,
        turnNumber: 7,
        matchVideoUrl: VALID_MATCH_URL,
        turnDeadline: future(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("legitimate: matcher (P2) takes their OWN missed letter (p2Letters + 1), game continues", async () => {
    await seedMatching(0); // no one on match point
    // Missed-continues: matcher +1 on themselves, setter keeps the role,
    // turnNumber + 1, currentTurn follows the (unchanged) setter.
    await assertSucceeds(
      updateDoc(gameDoc(authedContext(getEnv(), P2_UID), GAME_ID), {
        phase: "setting",
        p2Letters: 1,
        currentSetter: P1_UID,
        currentTurn: P1_UID,
        turnNumber: 8,
        turnHistory: [{ turnNumber: 7, landed: false, letterTo: P2_UID }],
        matchVideoUrl: VALID_MATCH_URL,
        turnDeadline: future(),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe("games — judge dispute resolution letter direction (targeted letter)", () => {
  // Fixture: phase = disputable, currentTurn = JUDGE (judge is ruling),
  // currentSetter = P1 → the disputed turn's matcher is P2. On overrule the
  // +1 must land on P2 (the matcher), never on P1 (the setter).
  const seedDisputed = (overrides: Record<string, unknown> = {}) =>
    seedGameForUpdate(
      getEnv(),
      GAME_ID,
      { player1Uid: P1_UID, player2Uid: P2_UID },
      {
        currentTurn: JUDGE_UID,
        phase: "disputable",
        currentSetter: P1_UID,
        judgeId: JUDGE_UID,
        judgeStatus: "accepted",
        p1Letters: 0,
        p2Letters: 0,
        ...overrides,
      },
    );

  it("attack: judge overrules and increments the SETTER (P1) instead of the matcher (P2)", async () => {
    await seedDisputed();
    // Overrule routes back to setting with the setter keeping the role. The
    // letter must go to the matcher (P2); crediting P1 must be rejected.
    await assertFails(
      updateDoc(
        gameDoc(authedContext(getEnv(), JUDGE_UID), GAME_ID),
        activeSettingUpdate({
          p1Letters: 1, // WRONG DIRECTION — should be P2 (the matcher)
          currentTurn: P1_UID,
        }),
      ),
    );
  });

  it("legitimate: judge overrules and increments the MATCHER (P2)", async () => {
    await seedDisputed();
    await assertSucceeds(
      updateDoc(
        gameDoc(authedContext(getEnv(), JUDGE_UID), GAME_ID),
        activeSettingUpdate({
          p2Letters: 1, // matcher takes the letter — correct direction
          currentTurn: P1_UID,
        }),
      ),
    );
  });

  it("legitimate: judge accepts the landed call (no letter change)", async () => {
    await seedDisputed();
    await assertSucceeds(
      updateDoc(
        gameDoc(authedContext(getEnv(), JUDGE_UID), GAME_ID),
        activeSettingUpdate({
          currentTurn: P2_UID,
        }),
      ),
    );
  });
});
