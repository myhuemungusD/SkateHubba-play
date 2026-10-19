/**
 * Firestore rules tests for the games collection — turn length
 * (VITE_FEATURE_TURN_LENGTH, src/services/turnDuration.ts).
 *
 * `turnLengthHours` is an OPTIONAL number set at game creation (24, 72 or 168)
 * and IMMUTABLE thereafter. Missing reads as 24, so every legacy game and every
 * game made while the flag is off keeps the exact 24h (±1h) clock. Every turn
 * clock, and the setter's accept/dispute window, must be request.time + the
 * game's own length (±1h). The community vote window stays 24h.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import * as fx from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-turnlength";
const P1_UID = "p1-alice";
const P2_UID = "p2-bob";
const OPTS = { player1Uid: P1_UID, player2Uid: P2_UID };
const HOUR = 60 * 60 * 1000;
const VALID_MATCH_URL = "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/match.webm";

const ahead = (hours: number) => new Date(Date.now() + hours * HOUR);

const getEnv = fx.setupRulesTestEnv(PROJECT_ID, fx.seedGameProfiles);

const asP1 = () => fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
const asP2 = () => fx.gameDoc(fx.authedContext(getEnv(), P2_UID), "g1");

describe("games rules — turn length", () => {
  describe("create", () => {
    it("accepts a game with no turnLengthHours and a 24h clock (flag off)", async () => {
      await assertSucceeds(fx.createGameWithAnchor(asP1(), fx.makeValidGame(OPTS)));
    });

    it("rejects a 3-day clock on a game with no turnLengthHours", async () => {
      await assertFails(fx.createGameWithAnchor(asP1(), fx.makeValidGame(OPTS, { turnDeadline: ahead(72) })));
    });

    it.each([24, 72, 168])("accepts turnLengthHours %i with a matching clock", async (hours) => {
      await assertSucceeds(
        fx.createGameWithAnchor(asP1(), fx.makeValidGame(OPTS, { turnLengthHours: hours, turnDeadline: ahead(hours) })),
      );
    });

    it("rejects a 7-day game whose clock is only 24h", async () => {
      await assertFails(
        fx.createGameWithAnchor(asP1(), fx.makeValidGame(OPTS, { turnLengthHours: 168, turnDeadline: ahead(24) })),
      );
    });

    it("rejects a 3-day game whose clock is 7 days", async () => {
      await assertFails(
        fx.createGameWithAnchor(asP1(), fx.makeValidGame(OPTS, { turnLengthHours: 72, turnDeadline: ahead(168) })),
      );
    });

    it.each([0, 1, 48, 720, "72", null, 72.5])("rejects turnLengthHours %s", async (bad) => {
      await assertFails(
        fx.createGameWithAnchor(asP1(), fx.makeValidGame(OPTS, { turnLengthHours: bad, turnDeadline: ahead(72) })),
      );
    });
  });

  describe("update — clocks follow the game's length", () => {
    it("accepts a 7-day turn clock on a 7-day game", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS, { turnLengthHours: 168 });
      await assertSucceeds(updateDoc(asP1(), fx.settingToMatchingUpdate(P2_UID, { turnDeadline: ahead(168) })));
    });

    it("rejects a 24h turn clock on a 7-day game", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS, { turnLengthHours: 168 });
      await assertFails(updateDoc(asP1(), fx.settingToMatchingUpdate(P2_UID, { turnDeadline: ahead(24) })));
    });

    it("rejects a 3-day turn clock on a legacy game (no field)", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS);
      await assertFails(updateDoc(asP1(), fx.settingToMatchingUpdate(P2_UID, { turnDeadline: ahead(72) })));
    });

    it("accepts the normal 24h clock on a legacy game (unchanged behavior)", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS);
      await assertSucceeds(updateDoc(asP1(), fx.settingToMatchingUpdate(P2_UID)));
    });
  });

  describe("update — immutability", () => {
    it("rejects changing turnLengthHours on a turn update", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS, { turnLengthHours: 168 });
      await assertFails(
        updateDoc(asP1(), fx.settingToMatchingUpdate(P2_UID, { turnLengthHours: 24, turnDeadline: ahead(24) })),
      );
    });

    it("rejects adding turnLengthHours to a legacy game", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS);
      await assertFails(
        updateDoc(asP1(), fx.settingToMatchingUpdate(P2_UID, { turnLengthHours: 168, turnDeadline: ahead(168) })),
      );
    });

    it("rejects dropping turnLengthHours with a full rewrite", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS, { turnLengthHours: 72, turnDeadline: ahead(72) });
      await assertFails(setDoc(asP1(), fx.makeValidGame(OPTS)));
    });

    it("accepts a forfeit on an expired 3-day game that leaves turnLengthHours alone", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS, {
        turnLengthHours: 72,
        currentTurn: P1_UID,
        turnDeadline: new Date(Date.now() - HOUR),
      });
      await assertSucceeds(updateDoc(asP2(), fx.forfeitUpdate(P2_UID)));
    });

    it("rejects a forfeit that also rewrites turnLengthHours", async () => {
      await fx.seedGameForUpdate(getEnv(), "g1", OPTS, {
        turnLengthHours: 72,
        currentTurn: P1_UID,
        turnDeadline: new Date(Date.now() - HOUR),
      });
      await assertFails(updateDoc(asP2(), fx.forfeitUpdate(P2_UID, { turnLengthHours: 168 })));
    });
  });

  describe("review windows", () => {
    function seedMatching7d() {
      return fx.seedGameForUpdate(getEnv(), "g1", OPTS, {
        turnLengthHours: 168,
        phase: "matching",
        currentSetter: P1_UID,
        currentTurn: P2_UID,
        turnNumber: 4,
        matchVideoUrl: null,
        turnDeadline: ahead(100),
      });
    }

    const freeze = (reviewHours: number, turnHours: number) => ({
      phase: "pendingReview",
      reviewFor: P2_UID,
      reviewDeadline: ahead(reviewHours),
      matchVideoUrl: VALID_MATCH_URL,
      turnDeadline: ahead(turnHours),
      updatedAt: serverTimestamp(),
    });

    it("a 7-day game's accept/dispute window is 7 days", async () => {
      await seedMatching7d();
      await assertSucceeds(updateDoc(asP2(), freeze(168, 168)));
    });

    it("rejects a 24h accept/dispute window on a 7-day game", async () => {
      await seedMatching7d();
      await assertFails(updateDoc(asP2(), freeze(24, 168)));
    });

    function seedPendingReview7d() {
      return fx.seedGameForUpdate(getEnv(), "g1", OPTS, {
        turnLengthHours: 168,
        phase: "pendingReview",
        currentSetter: P1_UID,
        currentTurn: P2_UID,
        turnNumber: 4,
        reviewFor: P2_UID,
        reviewDeadline: ahead(100),
        matchVideoUrl: VALID_MATCH_URL,
        turnDeadline: ahead(100),
      });
    }

    it("the community vote window stays 24h on a 7-day game", async () => {
      await seedPendingReview7d();
      await assertSucceeds(
        updateDoc(asP1(), { phase: "communityReview", reviewDeadline: ahead(24), updatedAt: serverTimestamp() }),
      );
    });

    it("rejects a 7-day community vote window", async () => {
      await seedPendingReview7d();
      await assertFails(
        updateDoc(asP1(), { phase: "communityReview", reviewDeadline: ahead(168), updatedAt: serverTimestamp() }),
      );
    });

    it("accepting a landed claim on a 7-day game starts a 7-day turn", async () => {
      await seedPendingReview7d();
      const accept = (hours: number) => ({
        phase: "setting",
        currentSetter: P2_UID,
        currentTurn: P2_UID,
        turnNumber: 5,
        turnHistory: [{ turnNumber: 4, landed: true, letterTo: null, matcherUid: P2_UID }],
        reviewFor: null,
        reviewDeadline: null,
        turnDeadline: ahead(hours),
        updatedAt: serverTimestamp(),
      });
      await assertFails(updateDoc(asP1(), accept(24)));
      await assertSucceeds(updateDoc(asP1(), accept(168)));
    });
  });
});
