/**
 * Firestore rules tests for the /notification_limits collection.
 *
 * These docs are server-managed cooldown state for the 5-second notification
 * rate limiter in src/services/notifications.ts. They only contain
 * { senderUid, gameId, type, lastSentAt } — no recipientUid — so a previous
 * delete rule that checked resource.data.recipientUid was both broken and
 * wrong in intent. Clients must never delete these docs, otherwise a malicious
 * sender could reset their own cooldown and spam notifications.
 *
 * Run via:  npm run test:rules
 */
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
  type RulesTestContext,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deleteDoc, doc, serverTimestamp, setDoc, setLogLevel, updateDoc } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-notif-limits";

const SENDER_UID = "sender-uid";
const OTHER_UID = "stranger-uid";
const GAME_ID = "game-abc";
const TYPE = "your_turn";
const LIMIT_ID = `${SENDER_UID}_${GAME_ID}_${TYPE}`;

let testEnv: RulesTestEnvironment;

function asSender(): RulesTestContext {
  return testEnv.authenticatedContext(SENDER_UID, { email_verified: true });
}

function asStranger(): RulesTestContext {
  return testEnv.authenticatedContext(OTHER_UID, { email_verified: true });
}

function limitRef(ctx: RulesTestContext, id: string = LIMIT_ID) {
  return doc(ctx.firestore(), "notification_limits", id);
}

/** Seed a notification_limits doc with the exact shape written by the service layer. */
async function seedLimit(overrides: Record<string, unknown> = {}): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "notification_limits", LIMIT_ID), {
      senderUid: SENDER_UID,
      gameId: GAME_ID,
      type: TYPE,
      // Back-date so the 5s update cooldown passes when a test needs it.
      lastSentAt: new Date(Date.now() - 60_000),
      ...overrides,
    });
  });
}

beforeAll(async () => {
  setLogLevel("error");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe("notification_limits rules", () => {
  describe("delete", () => {
    it("rejects the sender deleting their own rate-limit doc", async () => {
      await seedLimit();
      await assertFails(deleteDoc(limitRef(asSender())));
    });

    it("rejects a stranger deleting someone else's rate-limit doc", async () => {
      await seedLimit();
      await assertFails(deleteDoc(limitRef(asStranger())));
    });

    it("rejects deletion even on docs missing recipientUid (regression guard)", async () => {
      // The previous buggy rule checked resource.data.recipientUid. These
      // docs never have that field, so the check always denied — but the
      // intent was ambiguous. This test pins the correct intent: deletes
      // are impossible regardless of document shape.
      await seedLimit();
      await assertFails(deleteDoc(limitRef(asSender())));
    });
  });

  describe("create (sanity anchor)", () => {
    // One happy-path create so a broken test harness or an accidental
    // rewrite of neighboring rules fails loudly instead of silently making
    // the delete tests vacuous.
    it("accepts a well-formed create from the sender", async () => {
      await assertSucceeds(
        setDoc(limitRef(asSender()), {
          senderUid: SENDER_UID,
          gameId: GAME_ID,
          type: TYPE,
          lastSentAt: serverTimestamp(),
        }),
      );
    });

    it("rejects a create with a stale lastSentAt (rate-limit bypass)", async () => {
      // Red-team: if the create rule accepted arbitrary lastSentAt values, a
      // client could seed ancient timestamps so the 5-second update cooldown
      // is instantly satisfied on every subsequent write. The rule now
      // requires lastSentAt == request.time (i.e. serverTimestamp()).
      await assertFails(
        setDoc(limitRef(asSender()), {
          senderUid: SENDER_UID,
          gameId: GAME_ID,
          type: TYPE,
          // Epoch 0 — a classic stale-timestamp attack.
          lastSentAt: new Date(0),
        }),
      );
    });

    it("rejects a create with a client-wall-clock lastSentAt (must be serverTimestamp)", async () => {
      // Even a "current-looking" client wall-clock value must be rejected —
      // the only trusted anchor is request.time. Clients with skewed clocks
      // (or a hostile client) would otherwise shave seconds off the cooldown.
      await assertFails(
        setDoc(limitRef(asSender()), {
          senderUid: SENDER_UID,
          gameId: GAME_ID,
          type: TYPE,
          lastSentAt: new Date(),
        }),
      );
    });
  });

  describe("update", () => {
    it("rejects an update that writes a stale lastSentAt (cooldown bypass)", async () => {
      // Seed an old lastSentAt so the 5s cooldown is satisfied, then attempt
      // to write back a stale lastSentAt. The prior rule accepted any new
      // value, which let a client keep the cooldown permanently cleared.
      await seedLimit({ lastSentAt: new Date(Date.now() - 60_000) });
      await assertFails(
        updateDoc(limitRef(asSender()), {
          lastSentAt: new Date(0),
        }),
      );
    });

    it("rejects an update that writes a client-wall-clock lastSentAt", async () => {
      await seedLimit({ lastSentAt: new Date(Date.now() - 60_000) });
      await assertFails(
        updateDoc(limitRef(asSender()), {
          lastSentAt: new Date(),
        }),
      );
    });

    it("rejects an update that mutates senderUid", async () => {
      await seedLimit({ lastSentAt: new Date(Date.now() - 60_000) });
      await assertFails(
        updateDoc(limitRef(asSender()), {
          senderUid: OTHER_UID,
          lastSentAt: serverTimestamp(),
        }),
      );
    });

    it("rejects an update that mutates gameId", async () => {
      await seedLimit({ lastSentAt: new Date(Date.now() - 60_000) });
      await assertFails(
        updateDoc(limitRef(asSender()), {
          gameId: "other-game",
          lastSentAt: serverTimestamp(),
        }),
      );
    });

    it("rejects an update that mutates type", async () => {
      await seedLimit({ lastSentAt: new Date(Date.now() - 60_000) });
      await assertFails(
        updateDoc(limitRef(asSender()), {
          type: "new_challenge",
          lastSentAt: serverTimestamp(),
        }),
      );
    });

    it("accepts a well-formed update from the sender after the 5s cooldown", async () => {
      await seedLimit({ lastSentAt: new Date(Date.now() - 60_000) });
      await assertSucceeds(
        updateDoc(limitRef(asSender()), {
          lastSentAt: serverTimestamp(),
        }),
      );
    });
  });
});
