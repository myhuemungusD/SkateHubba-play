/**
 * Firestore rules tests for the games collection — specifically the spotId
 * invariants added by the April 2026 map audit P0 #3 polish pass.
 *
 * Shared harness (env bootstrap, valid-game factory, seed + update helpers)
 * lives in ./_fixtures so this suite stays free of copy-pasted boilerplate.
 *
 * These run OUT of the vitest unit suite because they spin up a real
 * Firestore emulator and need a network port (8080). Run with:
 *
 *     npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import * as fx from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules";
const P1_UID = "p1-alice";
const P2_UID = "p2-bob";
const VALID_SPOT_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_SPOT_ID = "22222222-3333-4444-5555-666666666666";
const OPTS = { player1Uid: P1_UID, player2Uid: P2_UID };

const getEnv = fx.setupRulesTestEnv(PROJECT_ID);

describe("games rules — spotId invariants", () => {
  describe("create", () => {
    it("accepts a game with no spotId (baseline)", async () => {
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertSucceeds(setDoc(ref, fx.makeValidGame(OPTS)));
    });

    it("accepts a game with a string spotId", async () => {
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertSucceeds(setDoc(ref, fx.makeValidGame(OPTS, { spotId: VALID_SPOT_ID })));
    });

    it("rejects a non-string spotId", async () => {
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertFails(setDoc(ref, fx.makeValidGame(OPTS, { spotId: 12345 })));
    });

    it("rejects a spotId that is not a string (object)", async () => {
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertFails(setDoc(ref, fx.makeValidGame(OPTS, { spotId: { injected: true } })));
    });

    it("rejects a spotId longer than 64 characters", async () => {
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertFails(setDoc(ref, fx.makeValidGame(OPTS, { spotId: "x".repeat(65) })));
    });

    it("accepts a spotId exactly 64 characters", async () => {
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertSucceeds(setDoc(ref, fx.makeValidGame(OPTS, { spotId: "x".repeat(64) })));
    });
  });

  describe("update — immutability", () => {
    it("rejects adding a spotId to a previously-spotless game", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS);
      // P1 attempts to set trick AND inject a spotId — should be rejected
      // by the immutability clause in the normal turn-update rule.
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertFails(updateDoc(ref, fx.settingToMatchingUpdate(P2_UID, { spotId: VALID_SPOT_ID })));
    });

    it("rejects changing an existing spotId on a turn update", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS, { spotId: VALID_SPOT_ID });
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertFails(updateDoc(ref, fx.settingToMatchingUpdate(P2_UID, { spotId: OTHER_SPOT_ID })));
    });

    it("accepts a normal turn update that leaves spotId untouched", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS, { spotId: VALID_SPOT_ID });
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertSucceeds(updateDoc(ref, fx.settingToMatchingUpdate(P2_UID)));
    });

    it("rejects removing an existing spotId on a turn update", async () => {
      // Firestore has no native "delete field" at the rules level (a delete
      // shows up as a missing field in the resource data). A full rewrite
      // (setDoc without merge) effectively drops spotId, which the
      // immutability clause must reject.
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS, { spotId: VALID_SPOT_ID });
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
      await assertFails(setDoc(ref, fx.makeValidGame(OPTS)));
    });

    it("rejects changing spotId on a match-resolution update", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS, {
        spotId: VALID_SPOT_ID,
        phase: "matching",
        currentTurn: P2_UID,
      });
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P2_UID), "g1");
      await assertFails(
        updateDoc(ref, {
          phase: "setting",
          currentSetter: P2_UID,
          currentTurn: P2_UID,
          currentTrickName: null,
          currentTrickVideoUrl: null,
          matchVideoUrl: null,
          turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
          updatedAt: serverTimestamp(),
          spotId: OTHER_SPOT_ID,
        }),
      );
    });

    it("rejects changing spotId on a forfeit update", async () => {
      // Back-date turnDeadline so the forfeit rule's "deadline expired" guard passes.
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS, {
        spotId: VALID_SPOT_ID,
        turnDeadline: new Date(Date.now() - 60_000),
      });
      const ref = fx.gameDoc(fx.authedContext(getEnv(), P2_UID), "g1");
      await assertFails(
        updateDoc(ref, {
          status: "forfeit",
          winner: P2_UID,
          updatedAt: serverTimestamp(),
          spotId: OTHER_SPOT_ID,
        }),
      );
    });
  });
});
