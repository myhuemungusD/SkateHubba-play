/**
 * Games — statsApplied forgery red-team (stats fan-out lockdown).
 *
 * `statsApplied` is written EXCLUSIVELY by the applyGameStats Cloud
 * Function (admin SDK, bypasses these rules). It flips to true inside the
 * same transaction that credits wins/losses for a terminal game, exactly
 * once. If a client could pre-set `statsApplied: true` (at creation or via
 * any update), the Cloud Function would treat the game as already-credited
 * and skip crediting the loser's loss forever — a silent way to dodge a
 * loss on the leaderboard.
 *
 * The rules therefore:
 *   - forbid `statsApplied` outright on the /games CREATE rule, and
 *   - pin it to its stored value on EVERY /games update branch via the
 *     shared statsAppliedUnchanged() helper (presence-pair form, no
 *     document reads).
 *
 * These tests prove the forgery paths are denied while the SAME writes
 * WITHOUT the flag still succeed (control cases), across the create rule,
 * the setting-phase turn-update branch, and the forfeit branch.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import {
  setupRulesTestEnv,
  authedContext,
  gameDoc,
  makeValidGame,
  seedGameForUpdate,
  settingToMatchingUpdate,
} from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-games-statsapplied-redteam";

const ALICE_UID = "alice-uid";
const BOB_UID = "bob-uid";

const getEnv = setupRulesTestEnv(PROJECT_ID);

describe("games CREATE — statsApplied cannot be forged at creation", () => {
  it("denied: create a game with statsApplied:true", async () => {
    const alice = authedContext(getEnv(), ALICE_UID);
    await assertFails(
      setDoc(
        gameDoc(alice, "game-create-flag-true"),
        makeValidGame({ player1Uid: ALICE_UID, player2Uid: BOB_UID }, { statsApplied: true }),
      ),
    );
  });

  it("denied: create a game with statsApplied:false (any presence is forbidden)", async () => {
    const alice = authedContext(getEnv(), ALICE_UID);
    await assertFails(
      setDoc(
        gameDoc(alice, "game-create-flag-false"),
        makeValidGame({ player1Uid: ALICE_UID, player2Uid: BOB_UID }, { statsApplied: false }),
      ),
    );
  });

  it("control: create a game WITHOUT statsApplied succeeds", async () => {
    const alice = authedContext(getEnv(), ALICE_UID);
    await assertSucceeds(
      setDoc(gameDoc(alice, "game-create-clean"), makeValidGame({ player1Uid: ALICE_UID, player2Uid: BOB_UID })),
    );
  });
});

describe("games UPDATE (setting→matching) — statsApplied cannot be introduced/flipped", () => {
  const GAME_ID = "game-setting-update";

  // Seed a game that already carries statsApplied:false — the stored-flag
  // shape both flip/carry tests below probe against.
  const seedFlaggedGame = () =>
    seedGameForUpdate(getEnv(), GAME_ID, { player1Uid: ALICE_UID, player2Uid: BOB_UID }, { statsApplied: false });

  it("denied: an otherwise-valid setting→matching update that ALSO adds statsApplied:true", async () => {
    await seedGameForUpdate(getEnv(), GAME_ID, { player1Uid: ALICE_UID, player2Uid: BOB_UID });
    const alice = authedContext(getEnv(), ALICE_UID);
    await assertFails(
      updateDoc(
        gameDoc(alice, GAME_ID),
        // Setter (Alice) hands off to Bob — valid shape — but tries to smuggle
        // the flag in the same write.
        settingToMatchingUpdate(BOB_UID, { statsApplied: true }),
      ),
    );
  });

  it("control: the SAME setting→matching update WITHOUT the flag succeeds", async () => {
    await seedGameForUpdate(getEnv(), GAME_ID, { player1Uid: ALICE_UID, player2Uid: BOB_UID });
    const alice = authedContext(getEnv(), ALICE_UID);
    await assertSucceeds(updateDoc(gameDoc(alice, GAME_ID), settingToMatchingUpdate(BOB_UID)));
  });

  it("denied: valid update that FLIPS a stored statsApplied:false → true", async () => {
    await seedFlaggedGame();
    const alice = authedContext(getEnv(), ALICE_UID);
    await assertFails(updateDoc(gameDoc(alice, GAME_ID), settingToMatchingUpdate(BOB_UID, { statsApplied: true })));
  });

  it("control: valid update on a doc already carrying statsApplied:false, leaving it unchanged, succeeds", async () => {
    // Benign game writes on a doc that already bears the flag (value carried
    // through unchanged) must keep working — the guard is value-based.
    await seedFlaggedGame();
    const alice = authedContext(getEnv(), ALICE_UID);
    await assertSucceeds(updateDoc(gameDoc(alice, GAME_ID), settingToMatchingUpdate(BOB_UID)));
  });
});

describe("games UPDATE (forfeit) — statsApplied cannot be introduced", () => {
  const FORFEIT_GAME_ID = "game-forfeit-flag";

  // Bob's turn has expired (deadline in the past); Alice forfeits him and
  // must be recorded as the winner (opponent of the current-turn player).
  const seedForfeitGame = () =>
    seedGameForUpdate(
      getEnv(),
      FORFEIT_GAME_ID,
      { player1Uid: ALICE_UID, player2Uid: BOB_UID },
      { currentTurn: BOB_UID, turnDeadline: new Date(Date.now() - 60_000) },
    );

  it("denied: forfeit write that adds statsApplied:true", async () => {
    await seedForfeitGame();
    const alice = authedContext(getEnv(), ALICE_UID);
    await assertFails(
      updateDoc(gameDoc(alice, FORFEIT_GAME_ID), {
        status: "forfeit",
        winner: ALICE_UID,
        statsApplied: true,
      }),
    );
  });

  it("control: forfeit write WITHOUT the flag succeeds", async () => {
    await seedForfeitGame();
    const alice = authedContext(getEnv(), ALICE_UID);
    await assertSucceeds(
      updateDoc(gameDoc(alice, FORFEIT_GAME_ID), {
        status: "forfeit",
        winner: ALICE_UID,
      }),
    );
  });
});
