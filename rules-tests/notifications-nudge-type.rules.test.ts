/**
 * `/notifications` create — `type: 'nudge'` (Aug 2026).
 *
 * Nudges historically produced a push + toast only, leaving no persistent
 * bell entry. The sender now writes a notification doc of type 'nudge'
 * alongside the nudge itself, gated by the SAME Path A companion-write
 * anchor (notification_limits/{senderUid_gameId_type} with
 * lastSentAt == request.time) as every other client-authored notification.
 *
 * This suite proves the type is accepted on the happy path and that none of
 * the surrounding constraints were loosened to make room for it — including
 * the nudge-scoped key allowlist, which the legacy types do not carry.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails, type RulesTestContext } from "@firebase/rules-unit-testing";
import { doc, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { seedValidGame, setupRulesTestEnv } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-notifications-nudge-type";

const NUDGER_UID = "nudger-cleo";
const NUDGED_UID = "nudged-dario";
const OUTSIDER_UID = "outsider-erin";
const GAME_ID = "g-nudge-notif";
const NOTIF_ID = "notif-nudge-1";
const NUDGE_TYPE = "nudge";
const LIMIT_ID = `${NUDGER_UID}_${GAME_ID}_${NUDGE_TYPE}`;

const getEnv = setupRulesTestEnv(PROJECT_ID, (env) =>
  seedValidGame(env, GAME_ID, { player1Uid: NUDGER_UID, player2Uid: NUDGED_UID }),
);

function asNudger(): RulesTestContext {
  return getEnv().authenticatedContext(NUDGER_UID, { email_verified: true });
}

function makeNudgeNotification(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    senderUid: NUDGER_UID,
    recipientUid: NUDGED_UID,
    gameId: GAME_ID,
    type: NUDGE_TYPE,
    title: "@cleo is waiting on you",
    body: "Your turn is still open — go film it.",
    read: false,
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

/** Path A: nudge notification + companion notification_limits, one batch. */
async function submitNudgeBatch(
  notifOverrides: Record<string, unknown> = {},
  limitOverrides: Record<string, unknown> = {},
): Promise<void> {
  const ctx = asNudger();
  const batch = writeBatch(ctx.firestore());
  batch.set(doc(ctx.firestore(), "notifications", NOTIF_ID), makeNudgeNotification(notifOverrides));
  batch.set(doc(ctx.firestore(), "notification_limits", LIMIT_ID), {
    senderUid: NUDGER_UID,
    gameId: GAME_ID,
    type: NUDGE_TYPE,
    lastSentAt: serverTimestamp(),
    ...limitOverrides,
  });
  await batch.commit();
}

describe("notifications — type 'nudge'", () => {
  it("legitimate: nudge notification + companion limits doc commit atomically", async () => {
    await assertSucceeds(submitNudgeBatch());
  });

  it("attack: CANNOT create a nudge notification without the limits companion", async () => {
    // No limits doc and no games update in the batch — neither getAfter()
    // anchor is satisfied post-commit, so the create is rejected.
    const ctx = asNudger();
    await assertFails(setDoc(doc(ctx.firestore(), "notifications", NOTIF_ID), makeNudgeNotification()));
  });

  it("attack: CANNOT spoof the nudge limits doc with a stale lastSentAt", async () => {
    await assertFails(submitNudgeBatch({}, { lastSentAt: new Date(0) }));
  });

  it("attack: CANNOT create a nudge notification with a mismatched senderUid", async () => {
    // Forging senderUid to another participant would make the bell entry look
    // like it came from the opponent, and would decouple the doc from the
    // limits key the batch actually refreshes.
    await assertFails(submitNudgeBatch({ senderUid: NUDGED_UID }));
  });

  it("attack: an outsider CANNOT create a nudge notification for a game they're not in", async () => {
    const ctx = getEnv().authenticatedContext(OUTSIDER_UID, { email_verified: true });
    const batch = writeBatch(ctx.firestore());
    batch.set(doc(ctx.firestore(), "notifications", NOTIF_ID), {
      ...makeNudgeNotification(),
      senderUid: OUTSIDER_UID,
    });
    batch.set(doc(ctx.firestore(), "notification_limits", `${OUTSIDER_UID}_${GAME_ID}_${NUDGE_TYPE}`), {
      senderUid: OUTSIDER_UID,
      gameId: GAME_ID,
      type: NUDGE_TYPE,
      lastSentAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it("attack: CANNOT smuggle arbitrary extra fields into a nudge notification", async () => {
    await assertFails(submitNudgeBatch({ payload: { deepLink: "https://evil.example/x" } }));
  });

  it("attack: CANNOT create a nudge notification pre-marked as read", async () => {
    await assertFails(submitNudgeBatch({ read: true }));
  });

  it("attack: CANNOT create a nudge notification addressed to self", async () => {
    await assertFails(submitNudgeBatch({ recipientUid: NUDGER_UID }));
  });
});
