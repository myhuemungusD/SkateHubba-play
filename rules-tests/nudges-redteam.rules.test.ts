/**
 * Nudges rate-limit red-team — proves the May 2026 H1 hardening that gates
 * `/nudges` creation on a companion `/nudge_limits/{senderUid_gameId}` write
 * with `lastNudgedAt == request.time`.
 *
 * Before the fix, the rule only checked the (pre-batch) state of the limit
 * doc via the limit doc's own create/update rules. A malicious client could
 * write to `/nudges` and simply NOT write the rate-limit doc — the cooldown
 * never advanced, and the sender could spam push-notification pokes at an
 * idle opponent indefinitely. The hardened rule:
 *
 *   1. Rejects a /nudges create unless the same batch also writes
 *      /nudge_limits/{senderUid_gameId} with lastNudgedAt == request.time.
 *   2. Cascades to the limit doc's own rules — `lastNudgedAt == request.time`
 *      on create, and a 1-hour cooldown gate on update — so a stale or
 *      spoofed timestamp on the companion write fails the whole batch.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails, type RulesTestContext } from "@firebase/rules-unit-testing";
import { doc, deleteDoc, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { seedValidGame, setupRulesTestEnv } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-nudges-redteam";

const SENDER_UID = "sender-alice";
const RECIPIENT_UID = "recipient-bob";
const GAME_ID = "g-nudge";
const NUDGE_ID = "n-1";
const LIMIT_ID = `${SENDER_UID}_${GAME_ID}`;

const getEnv = setupRulesTestEnv(PROJECT_ID, (env) =>
  seedValidGame(env, GAME_ID, { player1Uid: SENDER_UID, player2Uid: RECIPIENT_UID }),
);

function asSender(): RulesTestContext {
  return getEnv().authenticatedContext(SENDER_UID, { email_verified: true });
}

function makeValidNudge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    senderUid: SENDER_UID,
    senderUsername: "alice",
    recipientUid: RECIPIENT_UID,
    gameId: GAME_ID,
    delivered: false,
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedLimit(lastNudgedAt: Date): Promise<void> {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "nudge_limits", LIMIT_ID), {
      senderUid: SENDER_UID,
      gameId: GAME_ID,
      lastNudgedAt,
    });
  });
}

/** Batch-write a nudge AND its companion limit doc — the prod shape after the H1 fix. */
async function submitNudgeBatch(
  nudgeOverrides: Record<string, unknown> = {},
  limitOverrides: Record<string, unknown> = {},
): Promise<void> {
  const ctx = asSender();
  const nudgeRef = doc(ctx.firestore(), "nudges", NUDGE_ID);
  const limitRef = doc(ctx.firestore(), "nudge_limits", LIMIT_ID);
  const batch = writeBatch(ctx.firestore());
  batch.set(nudgeRef, makeValidNudge(nudgeOverrides));
  batch.set(limitRef, {
    senderUid: SENDER_UID,
    gameId: GAME_ID,
    lastNudgedAt: serverTimestamp(),
    ...limitOverrides,
  });
  await batch.commit();
}

describe("nudges — companion write + 1h cooldown (H1)", () => {
  it("legitimate: first-ever nudge writes both the nudge and the limit doc", async () => {
    await assertSucceeds(submitNudgeBatch());
  });

  it("attack: CANNOT submit a nudge without the companion nudge_limits write", async () => {
    // The classic H1 bypass — write /nudges and just skip the rate-limit
    // doc. The new getAfter() check rejects: post-batch the limit doc
    // doesn't exist (or has the wrong shape), so the rule fails.
    const ctx = asSender();
    await assertFails(setDoc(doc(ctx.firestore(), "nudges", NUDGE_ID), makeValidNudge()));
  });

  it("attack: CANNOT submit a second nudge 30 minutes after the first", async () => {
    // Seed a limit doc with lastNudgedAt 30 min ago — well inside the 1h
    // cooldown. The companion limit-doc update rule rejects, which fails
    // the whole batch.
    await seedLimit(new Date(Date.now() - 30 * 60 * 1000));
    await assertFails(submitNudgeBatch());
  });

  it("legitimate: CAN submit a second nudge 61 minutes after the first", async () => {
    await seedLimit(new Date(Date.now() - 61 * 60 * 1000));
    await assertSucceeds(submitNudgeBatch());
  });

  it("attack: CANNOT spoof the limit doc with a stale (epoch 0) lastNudgedAt", async () => {
    // The companion write tries to pin lastNudgedAt to epoch 0 so the
    // 1-hour cooldown is instantly satisfied on every future nudge. The
    // limit-doc create rule (lastNudgedAt == request.time) rejects, which
    // cascades to fail the whole batch.
    await assertFails(submitNudgeBatch({}, { lastNudgedAt: new Date(0) }));
  });

  it("attack: CANNOT spoof the limit doc with a client-wall-clock lastNudgedAt", async () => {
    // Even a "now-ish" client timestamp is rejected — only request.time
    // (serverTimestamp) is trusted. Mirrors the notification_limits and
    // reports_limits patterns.
    await assertFails(submitNudgeBatch({}, { lastNudgedAt: new Date() }));
  });

  it("attack: CANNOT submit a nudge whose batch writes the WRONG limit doc id", async () => {
    // The getAfter() check is keyed on `${senderUid}_${gameId}`. Writing a
    // companion doc under a different id leaves the canonical limit doc
    // empty post-batch, so the nudge rule rejects.
    const ctx = asSender();
    const nudgeRef = doc(ctx.firestore(), "nudges", NUDGE_ID);
    const wrongLimitRef = doc(ctx.firestore(), "nudge_limits", `${SENDER_UID}_other-game`);
    const batch = writeBatch(ctx.firestore());
    batch.set(nudgeRef, makeValidNudge());
    batch.set(wrongLimitRef, {
      senderUid: SENDER_UID,
      gameId: "other-game",
      lastNudgedAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it("attack: CANNOT delete the limit doc to reset the 1h cooldown", async () => {
    await seedLimit(new Date(Date.now() - 5 * 60 * 1000));
    const ctx = asSender();
    await assertFails(deleteDoc(doc(ctx.firestore(), "nudge_limits", LIMIT_ID)));
  });
});
