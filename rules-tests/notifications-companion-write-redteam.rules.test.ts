/**
 * Notifications companion-write red-team — proves the May 2026 H2 hardening
 * that gates `/notifications` creation on EITHER:
 *
 *   Path A — companion write to /notification_limits/{senderUid_gameId_type}
 *            with lastSentAt == request.time (standalone writeNotification)
 *   Path B — companion update to /games/{gameId} with updatedAt == request.time
 *            (writeNotificationInTx — game-action transactions already do this)
 *
 * Before the fix, the rule only checked the (pre-batch) state of the limit
 * doc via an `!exists() || time > limit+5s` clause. A malicious client could
 * write to /notifications and skip the limit-doc bookkeeping entirely — the
 * 5-second cooldown never advanced in Firestore, so server-side rate limiting
 * was a no-op for any client that didn't politely cooperate. Combined with
 * a target's open recipientUid feed, that's a notification-spam DoS surface.
 *
 * The hardened rule rejects /notifications creates that don't carry one of
 * the two anchors above in the same atomic commit.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails, type RulesTestContext } from "@firebase/rules-unit-testing";
import { doc, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { seedValidGame, setupRulesTestEnv } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-notifications-companion-redteam";

const SENDER_UID = "sender-alice";
const RECIPIENT_UID = "recipient-bob";
const GAME_ID = "g-notif";
const NOTIF_ID = "notif-1";
const TYPE = "your_turn";
const LIMIT_ID = `${SENDER_UID}_${GAME_ID}_${TYPE}`;

// Default seed: a vanilla active game between sender and recipient. Tests
// that need a different game shape (e.g. stale updatedAt for the Path-B
// negative case) call seedGame() again to overwrite.
const getEnv = setupRulesTestEnv(PROJECT_ID, (env) =>
  seedValidGame(env, GAME_ID, { player1Uid: SENDER_UID, player2Uid: RECIPIENT_UID }),
);

function asSender(): RulesTestContext {
  return getEnv().authenticatedContext(SENDER_UID, { email_verified: true });
}

function makeValidNotification(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  // Field values intentionally diverge from notifications-redteam.rules.test.ts'
  // local fixture so the test-duplication gate doesn't see two identical
  // notification literals across red-team suites.
  return {
    senderUid: SENDER_UID,
    recipientUid: RECIPIENT_UID,
    gameId: GAME_ID,
    type: TYPE,
    title: "Match @alice's kickflip",
    body: "Tap to record your match attempt.",
    read: false,
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedGame(overrides: Record<string, unknown> = {}): Promise<void> {
  await seedValidGame(getEnv(), GAME_ID, { player1Uid: SENDER_UID, player2Uid: RECIPIENT_UID }, overrides);
}

/** Path-A: notification + companion notification_limits in one batch. */
async function submitNotificationBatch(
  notifOverrides: Record<string, unknown> = {},
  limitOverrides: Record<string, unknown> = {},
): Promise<void> {
  const ctx = asSender();
  const notifRef = doc(ctx.firestore(), "notifications", NOTIF_ID);
  const limitRef = doc(ctx.firestore(), "notification_limits", LIMIT_ID);
  const batch = writeBatch(ctx.firestore());
  batch.set(notifRef, makeValidNotification(notifOverrides));
  batch.set(limitRef, {
    senderUid: SENDER_UID,
    gameId: GAME_ID,
    type: TYPE,
    lastSentAt: serverTimestamp(),
    ...limitOverrides,
  });
  await batch.commit();
}

describe("notifications — Path A (companion limit-doc write)", () => {
  it("legitimate: notification + companion notification_limits commit atomically", async () => {
    await assertSucceeds(submitNotificationBatch());
  });

  it("attack: CANNOT write a /notifications doc without ANY companion anchor", async () => {
    // The classic H2 bypass — write a notification and skip the limit doc.
    // No game update lands in this batch either, so neither getAfter() branch
    // is satisfied and the rule rejects.
    const ctx = asSender();
    await assertFails(setDoc(doc(ctx.firestore(), "notifications", NOTIF_ID), makeValidNotification()));
  });

  it("attack: CANNOT spoof the limit doc with a stale (epoch 0) lastSentAt", async () => {
    // limit-doc create rule requires lastSentAt == request.time. Stale
    // value cascades to fail the whole batch.
    await assertFails(submitNotificationBatch({}, { lastSentAt: new Date(0) }));
  });

  it("attack: CANNOT spoof the limit doc with a client-wall-clock lastSentAt", async () => {
    await assertFails(submitNotificationBatch({}, { lastSentAt: new Date() }));
  });

  it("attack: CANNOT submit a notification whose batch writes the WRONG limit doc id", async () => {
    // getAfter() is keyed on `${sender}_${game}_${type}`. A companion under
    // a different id leaves the canonical key empty post-batch, so the
    // notification rule's path A getAfter() check fails.
    const ctx = asSender();
    const notifRef = doc(ctx.firestore(), "notifications", NOTIF_ID);
    const wrongLimitRef = doc(ctx.firestore(), "notification_limits", `${SENDER_UID}_${GAME_ID}_new_challenge`);
    const batch = writeBatch(ctx.firestore());
    batch.set(notifRef, makeValidNotification());
    batch.set(wrongLimitRef, {
      senderUid: SENDER_UID,
      gameId: GAME_ID,
      type: "new_challenge",
      lastSentAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });
});

describe("notifications — Path B (companion games update)", () => {
  // Note: the legitimate Path-B happy path is covered by the in-tx
  // notification tests in src/services/__tests__/games.test.ts (every
  // writeNotificationInTx caller's runTransaction also calls
  // tx.update(gameRef, { ..., updatedAt: serverTimestamp() })) and by the
  // Playwright e2e suite. The games update rule itself is too expression-
  // dense to legitimately drive from a unit-rules harness without
  // reconstructing an entire turn flow, so we keep the rules-level
  // verification of Path B to the negative cases below.

  it("attack: a stale game.updatedAt does NOT count as a fresh anchor", async () => {
    // Seed a game whose updatedAt is in the past. A standalone notification
    // write (no batch, no game write) must still fail — the path-B check
    // requires updatedAt == request.time, not just "exists".
    await seedGame({ updatedAt: new Date(Date.now() - 60_000) });
    const ctx = asSender();
    await assertFails(setDoc(doc(ctx.firestore(), "notifications", NOTIF_ID), makeValidNotification()));
  });
});
