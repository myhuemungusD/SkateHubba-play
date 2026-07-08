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
const VALID_CATEGORIES = [
  "any",
  "flip",
  "grind",
  "air",
  "manual",
  "oldschool",
  "flatground",
  "switch",
  "flatbar",
  "transition",
  "team2v2",
  "custom",
] as const;
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

    it("rejects an unknown trickCategory string ('kickflips')", async () => {
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertFails(setDoc(ref, fx.makeValidGame(OPTS, { trickCategory: "kickflips" })));
    });

    it("rejects a numeric trickCategory (123)", async () => {
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertFails(setDoc(ref, fx.makeValidGame(OPTS, { trickCategory: 123 })));
    });

    it("rejects a null trickCategory", async () => {
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertFails(setDoc(ref, fx.makeValidGame(OPTS, { trickCategory: null })));
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
  });

  // The judge invite rule pins its own explicit field list, so trickCategory
  // needs its own pin there — a judge flipping judgeStatus must not be able to
  // smuggle a category rewrite into the same write (PR #406 review finding).
  describe("update — judge invite accept/decline", () => {
    const JUDGE_UID = "judge-carol";
    const JUDGE_FIELDS = { judgeId: JUDGE_UID, judgeUsername: "carol", judgeStatus: "pending" };

    it("accepts an invite acceptance that leaves trickCategory untouched", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS, { ...JUDGE_FIELDS, trickCategory: "flip" });
      const ref = fx.gameDoc(fx.authedContext(getEnv(), JUDGE_UID), "g1");
      await assertSucceeds(updateDoc(ref, { judgeStatus: "accepted" }));
    });

    it("rejects an invite acceptance that changes trickCategory", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS, { ...JUDGE_FIELDS, trickCategory: "flip" });
      const ref = fx.gameDoc(fx.authedContext(getEnv(), JUDGE_UID), "g1");
      await assertFails(updateDoc(ref, { judgeStatus: "accepted", trickCategory: "grind" }));
    });

    it("rejects an invite decline that adds trickCategory to a legacy doc", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS, JUDGE_FIELDS);
      const ref = fx.gameDoc(fx.authedContext(getEnv(), JUDGE_UID), "g1");
      await assertFails(updateDoc(ref, { judgeStatus: "declined", trickCategory: "flip" }));
    });
  });

  // customRules is the challenger's free-text for custom games — a bounded,
  // optional string set at creation and immutable thereafter (pairs with the
  // 'custom' category). Mirrors the trickCategory invariants.
  describe("customRules (custom-game free text)", () => {
    describe("create", () => {
      it("accepts a custom game with bounded customRules text", async () => {
        const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
        await assertSucceeds(
          setDoc(ref, fx.makeValidGame(OPTS, { trickCategory: "custom", customRules: "mongo only, no pushing" })),
        );
      });

      it("accepts an explicit null customRules (non-custom game)", async () => {
        const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
        await assertSucceeds(setDoc(ref, fx.makeValidGame(OPTS, { trickCategory: "flip", customRules: null })));
      });

      it("rejects customRules over the 120-char limit", async () => {
        const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
        await assertFails(
          setDoc(ref, fx.makeValidGame(OPTS, { trickCategory: "custom", customRules: "x".repeat(121) })),
        );
      });

      it("rejects a non-string customRules (number)", async () => {
        const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
        await assertFails(setDoc(ref, fx.makeValidGame(OPTS, { trickCategory: "custom", customRules: 123 })));
      });
    });

    describe("update — immutability", () => {
      it("accepts a turn update that carries customRules unchanged", async () => {
        await fx.seedGameForUpdate(getEnv(), "g1", OPTS, { trickCategory: "custom", customRules: "no pushing" });
        const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
        await assertSucceeds(
          updateDoc(ref, fx.settingToMatchingUpdate(P2_UID, { trickCategory: "custom", customRules: "no pushing" })),
        );
      });

      it("rejects changing customRules on a turn update", async () => {
        await fx.seedGameForUpdate(getEnv(), "g1", OPTS, { trickCategory: "custom", customRules: "no pushing" });
        const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
        await assertFails(
          updateDoc(ref, fx.settingToMatchingUpdate(P2_UID, { trickCategory: "custom", customRules: "mongo only" })),
        );
      });
    });
  });
});
