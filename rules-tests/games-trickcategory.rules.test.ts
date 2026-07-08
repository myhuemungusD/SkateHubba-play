/**
 * Firestore rules tests for the games collection — specifically the
 * trickCategory invariants (game-level trick filter, July 2026).
 *
 * trickCategory is an OPTIONAL string set at game creation and IMMUTABLE
 * thereafter — it mirrors the existing spotId pattern exactly. Legacy
 * deployed clients still create games WITHOUT the field, so presence must
 * stay optional at create.
 *
 * Shared harness (env bootstrap, valid-game factory, seed + update helpers)
 * lives in ./_fixtures so this suite stays free of copy-pasted boilerplate.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { setDoc, updateDoc } from "firebase/firestore";
import * as fx from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-trickcategory";
const P1_UID = "p1-alice";
const P2_UID = "p2-bob";
const VALID_CATEGORIES = ["any", "flip", "grind", "air", "manual", "oldschool"] as const;
const OPTS = { player1Uid: P1_UID, player2Uid: P2_UID };

const getEnv = fx.setupRulesTestEnv(PROJECT_ID);

describe("games rules — trickCategory invariants", () => {
  describe("create", () => {
    it("accepts a game with no trickCategory (legacy client baseline)", async () => {
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertSucceeds(setDoc(ref, fx.makeValidGame(OPTS)));
    });

    it("accepts a game with trickCategory 'flip'", async () => {
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertSucceeds(setDoc(ref, fx.makeValidGame(OPTS, { trickCategory: "flip" })));
    });

    it.each(VALID_CATEGORIES)("accepts trickCategory '%s'", async (category) => {
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertSucceeds(setDoc(ref, fx.makeValidGame(OPTS, { trickCategory: category })));
    });

    // Mirror the unit-test negative set (see
    // `src/constants/__tests__/trickCategories.test.ts`) at the rules layer —
    // the rules ARE the real defense boundary, so any type the client's
    // normalizer would collapse to "any" must also be rejected server-side.
    it.each<[string, unknown]>([
      ["an unknown string", "kickflips"],
      ["an empty string", ""],
      ["a number", 123],
      ["null", null],
      ["a boolean", true],
      ["an array", ["flip"]],
      ["an object", { id: "flip" }],
    ])("rejects trickCategory that is %s", async (_label, raw) => {
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertFails(setDoc(ref, fx.makeValidGame(OPTS, { trickCategory: raw })));
    });
  });

  describe("update — immutability", () => {
    it("accepts a normal turn update that carries trickCategory unchanged", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS, { trickCategory: "flip" });
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertSucceeds(updateDoc(ref, fx.settingToMatchingUpdate(P2_UID, { trickCategory: "flip" })));
    });

    it("accepts a normal turn update on a game that never had a trickCategory", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS);
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertSucceeds(updateDoc(ref, fx.settingToMatchingUpdate(P2_UID)));
    });

    it("rejects changing an existing trickCategory on a turn update", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS, { trickCategory: "flip" });
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertFails(updateDoc(ref, fx.settingToMatchingUpdate(P2_UID, { trickCategory: "grind" })));
    });

    it("rejects adding a trickCategory to a game created without one (legacy doc)", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS);
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertFails(updateDoc(ref, fx.settingToMatchingUpdate(P2_UID, { trickCategory: "flip" })));
    });

    it("rejects removing an existing trickCategory (full rewrite strips it)", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS, { trickCategory: "flip" });
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      // A full rewrite (setDoc without merge) effectively drops trickCategory.
      await assertFails(setDoc(ref, fx.makeValidGame(OPTS)));
    });

    // Judge invite accept/decline is a distinct `allow update` block from the
    // normal turn update; its own whitelist doesn't automatically pin every
    // field. Cover the accept path explicitly so trickCategory can't be
    // smuggled alongside a `judgeStatus: accepted` write.
    describe("judge-invite accept path", () => {
      const JUDGE_UID = "j-charlie";
      async function seedPendingJudgeGame(): Promise<void> {
        await fx.seedGameForUpdate(getEnv(), "g1", OPTS, {
          trickCategory: "flip",
          judgeId: JUDGE_UID,
          judgeUsername: "charlie",
          judgeStatus: "pending",
        });
      }
      function asJudgeRef() {
        return fx.gameDoc(fx.authedContext(getEnv(), JUDGE_UID), "g1");
      }

      it("rejects changing trickCategory on a judge-accept write", async () => {
        await seedPendingJudgeGame();
        await assertFails(updateDoc(asJudgeRef(), { judgeStatus: "accepted", trickCategory: "grind" }));
      });

      it("accepts a judge-accept write that leaves trickCategory unchanged", async () => {
        await seedPendingJudgeGame();
        await assertSucceeds(updateDoc(asJudgeRef(), { judgeStatus: "accepted" }));
      });
    });
  });
});
