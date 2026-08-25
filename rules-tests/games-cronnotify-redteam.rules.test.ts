/**
 * Games — the cron-owned notification tombstones are server-only.
 *
 * `challengeNotifiedAt` and `turnReminderSentFor` are written EXCLUSIVELY by
 * api/cron/sweep-expired-turns.ts (Admin SDK, bypasses these rules) and read
 * back by it as "already handled, skip this game" marks. They live on the GAME
 * doc rather than on the notification doc precisely because the recipient can
 * DELETE a notification, which would otherwise resurrect the buzz every tick.
 *
 * That makes them a suppression lever aimed at the OPPONENT, and both ends in
 * a free forfeit win:
 *
 *   • challengeNotifiedAt — reconcileChallengeNotifications() skips any game
 *     where it is non-null. A challenger who seeds it AT CREATE and then
 *     simply never issues the client-side notification leaves the challenged
 *     player with no bell entry and no push, while the 24h forfeit clock runs.
 *
 *   • turnReminderSentFor — remindUpcomingDeadlines() skips when it equals the
 *     game's current turnNumber. The setting→matching write is the write that
 *     HANDS THE TURN to the opponent and leaves turnNumber unchanged, so a
 *     single smuggled field on the hot path kills that turn's "2 hours left"
 *     warning. Repeatable every turn.
 *
 * The /games rules are pin-based, NOT key-allowlist-based (no
 * `keys().hasOnly()` anywhere in the block), so an unrecognised field is
 * accepted by default. These fields therefore need an explicit pin —
 * cronNotifyTombstonesUnchanged() on all nine update branches plus an outright
 * presence ban on create. This suite is what proves it.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import * as fx from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-cronnotify";
const P1_UID = "p1-alice";
const P2_UID = "p2-bob";
const OPTS = { player1Uid: P1_UID, player2Uid: P2_UID };

/** A stored tombstone pair, as the cron would have left it. */
const STORED_TOMBSTONES = {
  challengeNotifiedAt: new Date(Date.now() - 60_000),
  turnReminderSentFor: 1,
} as const;

const getEnv = fx.setupRulesTestEnv(PROJECT_ID, fx.seedGameProfiles);

describe("games create — cron tombstones cannot be pre-seeded", () => {
  it("denied: challenger seeds challengeNotifiedAt to disarm the challenge backstop", async () => {
    const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
    await assertFails(setDoc(ref, fx.makeValidGame(OPTS, { challengeNotifiedAt: serverTimestamp() })));
  });

  it("denied: challenger seeds turnReminderSentFor for the opening turn", async () => {
    const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
    await assertFails(setDoc(ref, fx.makeValidGame(OPTS, { turnReminderSentFor: 1 })));
  });

  it("denied: even an explicitly-null challengeNotifiedAt (the ban is presence-based)", async () => {
    // A null is harmless to the cron (it treats null as "not notified"), but
    // the ban is deliberately presence-based like statsApplied: no client write
    // path has any business naming this field, and a value-based check would be
    // one relaxation away from accepting a real timestamp.
    const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
    await assertFails(setDoc(ref, fx.makeValidGame(OPTS, { challengeNotifiedAt: null })));
  });

  it("succeeds: the normal create, which names neither field", async () => {
    const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
    await assertSucceeds(setDoc(ref, fx.makeValidGame(OPTS)));
  });
});

describe("games update — cron tombstones cannot be smuggled or altered", () => {
  it("denied: turnReminderSentFor rides along on the setting→matching handoff", async () => {
    // THE exploit: this is the write that gives P2 the turn, and turnNumber is
    // unchanged across it, so stamping the current turnNumber here is exactly
    // what suppresses P2's 2-hour warning.
    await fx.seedGameForUpdate(getEnv(), "g1", OPTS);
    const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
    await assertFails(updateDoc(ref, fx.settingToMatchingUpdate(P2_UID, { turnReminderSentFor: 1 })));
  });

  it("denied: challengeNotifiedAt rides along on the setting→matching handoff", async () => {
    await fx.seedGameForUpdate(getEnv(), "g1", OPTS);
    const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
    await assertFails(updateDoc(ref, fx.settingToMatchingUpdate(P2_UID, { challengeNotifiedAt: serverTimestamp() })));
  });

  it("denied: the matcher re-stamps a stored turnReminderSentFor on match resolution", async () => {
    // Second branch, different actor: the matcher resolving a missed attempt.
    // turnNumber goes 1 → 2 here, so re-pointing the tombstone at the NEW turn
    // number would suppress the next reminder too.
    await fx.seedGameForUpdate(getEnv(), "g1", OPTS, {
      ...STORED_TOMBSTONES,
      phase: "matching",
      currentTurn: P2_UID,
    });
    const ref = fx.gameDoc(fx.authedContext(getEnv(), P2_UID), "g1");
    const missed = fx.activeSettingUpdate({
      p2Letters: 1,
      currentTurn: P1_UID,
      turnNumber: 2,
      currentTrickName: null,
      currentTrickVideoUrl: null,
      matchVideoUrl: null,
    });
    await assertFails(updateDoc(ref, { ...missed, turnReminderSentFor: 2 }));
  });

  it("denied: the forfeit claimant clears a stored challengeNotifiedAt", async () => {
    // Third branch. Clearing is tampering in its own right: a null re-arms the
    // reconcile pass, which would re-push a "New Challenge!" for a dead game.
    await fx.seedGameForUpdate(getEnv(), "g1", OPTS, {
      ...STORED_TOMBSTONES,
      turnDeadline: new Date(Date.now() - 60_000),
    });
    const ref = fx.gameDoc(fx.authedContext(getEnv(), P2_UID), "g1");
    await assertFails(updateDoc(ref, fx.forfeitUpdate(P2_UID, { challengeNotifiedAt: null })));
  });

  it("denied: a full-doc rewrite that DROPS the stored tombstones", async () => {
    // Firestore surfaces a dropped field as an absent one, so the presence-pair
    // form of the pin is what catches a setDoc-without-merge erase.
    await fx.seedGameForUpdate(getEnv(), "g1", OPTS, STORED_TOMBSTONES);
    const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
    await assertFails(setDoc(ref, fx.makeValidGame(OPTS)));
  });

  it("succeeds: a normal turn update on a game that already carries both tombstones", async () => {
    // The pin must not wedge live games: the cron stamps these mid-game, and
    // every subsequent client turn write has to keep flowing.
    await fx.seedGameForUpdate(getEnv(), "g1", OPTS, STORED_TOMBSTONES);
    const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
    await assertSucceeds(updateDoc(ref, fx.settingToMatchingUpdate(P2_UID)));
  });

  it("succeeds: a normal turn update on a legacy game carrying neither", async () => {
    await fx.seedGameForUpdate(getEnv(), "g1", OPTS);
    const ref = fx.gameDoc(fx.authedContext(getEnv(), P1_UID), "g1");
    await assertSucceeds(updateDoc(ref, fx.settingToMatchingUpdate(P2_UID)));
  });
});
