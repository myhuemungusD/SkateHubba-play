/**
 * Rate-limit bypass red-team — proves the April 2026 hardening for two
 * client-writable cooldown anchors:
 *
 *   1. users/{uid}.lastGameCreatedAt  (30s game-creation cooldown)
 *   2. nudge_limits.lastNudgedAt      (1h nudge cooldown, create + update)
 *
 * The third anchor (notification_limits.lastSentAt) has its own dedicated
 * test file — see notification-limits.rules.test.ts.
 *
 * Before the fix, each of these fields could be written with a stale value
 * (e.g. epoch 0 / new Date(0)), and the downstream cooldown check
 * (`request.time > field + N`) would then pass on every subsequent write —
 * effectively disabling server-side rate limiting. Rules now require each
 * field equal `request.time` on write (i.e. the client must write
 * serverTimestamp()), which is what the production services already do.
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
import { doc, serverTimestamp, setDoc, setLogLevel, updateDoc } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-rate-limit-redteam";

const OWNER_UID = "owner-uid";
const GAME_ID = "game-abc";
const NUDGE_LIMIT_ID = `${OWNER_UID}_${GAME_ID}`;

let testEnv: RulesTestEnvironment;

function asOwner(): RulesTestContext {
  return testEnv.authenticatedContext(OWNER_UID, { email_verified: true });
}

async function seedUser(overrides: Record<string, unknown> = {}): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", OWNER_UID), {
      uid: OWNER_UID,
      username: "alice",
      wins: 0,
      losses: 0,
      ...overrides,
    });
  });
}

async function seedNudgeLimit(overrides: Record<string, unknown> = {}): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "nudge_limits", NUDGE_LIMIT_ID), {
      senderUid: OWNER_UID,
      gameId: GAME_ID,
      // Back-date so the 1h cooldown passes when the test needs it.
      lastNudgedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      ...overrides,
    });
  });
}

function makeUserUpdate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: OWNER_UID,
    username: "alice",
    wins: 0,
    losses: 0,
    ...overrides,
  };
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

describe("users.lastGameCreatedAt — red-team against stale-timestamp cooldown reset", () => {
  beforeEach(async () => {
    await seedUser();
  });

  it("attack: owner CANNOT set lastGameCreatedAt to epoch 0 (game-creation spam)", async () => {
    // Without the fix, this would let the owner instantly satisfy the 30s
    // cooldown enforced by the /games create rule on their next create.
    await assertFails(
      setDoc(doc(asOwner().firestore(), "users", OWNER_UID), makeUserUpdate({ lastGameCreatedAt: new Date(0) })),
    );
  });

  it("attack: owner CANNOT set lastGameCreatedAt via client wall clock (must be serverTimestamp)", async () => {
    await assertFails(
      setDoc(doc(asOwner().firestore(), "users", OWNER_UID), makeUserUpdate({ lastGameCreatedAt: new Date() })),
    );
  });

  it("attack: owner CANNOT back-date an existing lastGameCreatedAt via updateDoc", async () => {
    await seedUser({ lastGameCreatedAt: new Date() });
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        lastGameCreatedAt: new Date(0),
      }),
    );
  });

  it("legitimate: owner CAN set lastGameCreatedAt via serverTimestamp()", async () => {
    // Mirrors the exact write in src/services/games.ts after addDoc().
    await assertSucceeds(
      setDoc(doc(asOwner().firestore(), "users", OWNER_UID), { lastGameCreatedAt: serverTimestamp() }, { merge: true }),
    );
  });

  it("legitimate: a user update that doesn't touch lastGameCreatedAt still works", async () => {
    // Regression guard: the new constraint is gated on the field being
    // written, so an unrelated profile update (e.g. fcmTokens) must still
    // pass even when lastGameCreatedAt already exists on the stored doc.
    await seedUser({ lastGameCreatedAt: new Date(Date.now() - 60_000) });
    await assertSucceeds(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        fcmTokens: ["token-a"],
      }),
    );
  });
});

describe("nudge_limits — red-team against stale-timestamp 1h cooldown bypass", () => {
  it("attack: sender CANNOT create nudge_limits with lastNudgedAt == epoch 0", async () => {
    // If accepted, every subsequent update would satisfy the 1h cooldown and
    // let the sender nudge a target endlessly.
    await assertFails(
      setDoc(doc(asOwner().firestore(), "nudge_limits", NUDGE_LIMIT_ID), {
        senderUid: OWNER_UID,
        gameId: GAME_ID,
        lastNudgedAt: new Date(0),
      }),
    );
  });

  it("attack: sender CANNOT create nudge_limits with client wall-clock lastNudgedAt", async () => {
    await assertFails(
      setDoc(doc(asOwner().firestore(), "nudge_limits", NUDGE_LIMIT_ID), {
        senderUid: OWNER_UID,
        gameId: GAME_ID,
        lastNudgedAt: new Date(),
      }),
    );
  });

  it("attack: sender CANNOT update nudge_limits with a stale lastNudgedAt", async () => {
    await seedNudgeLimit();
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "nudge_limits", NUDGE_LIMIT_ID), {
        lastNudgedAt: new Date(0),
      }),
    );
  });

  it("attack: sender CANNOT update nudge_limits with a client wall-clock lastNudgedAt", async () => {
    await seedNudgeLimit();
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "nudge_limits", NUDGE_LIMIT_ID), {
        lastNudgedAt: new Date(),
      }),
    );
  });

  it("attack: sender CANNOT mutate senderUid on update (doc-id desync)", async () => {
    await seedNudgeLimit();
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "nudge_limits", NUDGE_LIMIT_ID), {
        senderUid: "someone-else",
        lastNudgedAt: serverTimestamp(),
      }),
    );
  });

  it("attack: sender CANNOT mutate gameId on update (doc-id desync)", async () => {
    await seedNudgeLimit();
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "nudge_limits", NUDGE_LIMIT_ID), {
        gameId: "other-game",
        lastNudgedAt: serverTimestamp(),
      }),
    );
  });

  it("legitimate: sender CAN create nudge_limits with serverTimestamp()", async () => {
    await assertSucceeds(
      setDoc(doc(asOwner().firestore(), "nudge_limits", NUDGE_LIMIT_ID), {
        senderUid: OWNER_UID,
        gameId: GAME_ID,
        lastNudgedAt: serverTimestamp(),
      }),
    );
  });

  it("legitimate: sender CAN update nudge_limits after the 1h cooldown via serverTimestamp()", async () => {
    await seedNudgeLimit();
    await assertSucceeds(
      updateDoc(doc(asOwner().firestore(), "nudge_limits", NUDGE_LIMIT_ID), {
        lastNudgedAt: serverTimestamp(),
      }),
    );
  });
});
