/**
 * Red-team tests for rate-limit timestamp tampering — the class of bypass
 * where a client overwrites the server-read cooldown field with an old (or
 * zero) timestamp so subsequent "request.time > lastX + window" checks
 * always pass.
 *
 * Covers:
 *   - users.lastGameCreatedAt  (30-second game creation cooldown, line ~211 in firestore.rules)
 *   - users.lastSpotCreatedAt  (30-second spot creation cooldown, line ~671)
 *   - nudge_limits.lastNudgedAt (1-hour nudge cooldown, line ~902)
 *
 * The matching notification_limits.lastSentAt clamp is covered in
 * notification-limits.rules.test.ts — kept there because that file already
 * exercises the parent /notification_limits collection.
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
import { doc, serverTimestamp, setDoc, setLogLevel, Timestamp, updateDoc } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-ratelimit-tampering";

const OWNER_UID = "owner-uid";
const GAME_ID = "game-abc";

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
      // Back-date both timestamps so the creation rules elsewhere would
      // accept a fresh game/spot — we want to prove the client CANNOT
      // rewind them to a past value regardless.
      lastGameCreatedAt: Timestamp.fromMillis(Date.now() - 60_000),
      lastSpotCreatedAt: Timestamp.fromMillis(Date.now() - 60_000),
      ...overrides,
    });
  });
}

async function seedNudgeLimit(lastNudgedMsAgo = 2 * 60 * 60 * 1000): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "nudge_limits", `${OWNER_UID}_${GAME_ID}`), {
      senderUid: OWNER_UID,
      gameId: GAME_ID,
      // Back-date past the 1-hour cooldown so the update rule's time gate
      // would otherwise allow a write.
      lastNudgedAt: Timestamp.fromMillis(Date.now() - lastNudgedMsAgo),
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

describe("users.lastGameCreatedAt — tamper guard", () => {
  it("attack: owner CANNOT rewind lastGameCreatedAt to epoch", async () => {
    await seedUser();
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        lastGameCreatedAt: Timestamp.fromMillis(0),
      }),
    );
  });

  it("attack: owner CANNOT set lastGameCreatedAt to a fabricated past timestamp", async () => {
    await seedUser();
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        lastGameCreatedAt: Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000),
      }),
    );
  });

  it("attack: owner CANNOT set lastGameCreatedAt to a client-chosen future timestamp", async () => {
    await seedUser();
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        lastGameCreatedAt: Timestamp.fromMillis(Date.now() + 60_000),
      }),
    );
  });

  it("legitimate: owner CAN advance lastGameCreatedAt via serverTimestamp()", async () => {
    await seedUser();
    await assertSucceeds(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        lastGameCreatedAt: serverTimestamp(),
      }),
    );
  });

  it("legitimate: wins update that doesn't touch lastGameCreatedAt still passes", async () => {
    await seedUser();
    // Increment wins without mentioning lastGameCreatedAt — the rule's
    // "!('lastGameCreatedAt' in request.resource.data) || unchanged" branch
    // must allow this (otherwise every stat write would fail when the
    // field exists on the resource).
    await assertSucceeds(updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), { wins: 1 }));
  });
});

describe("users.lastSpotCreatedAt — tamper guard", () => {
  it("attack: owner CANNOT rewind lastSpotCreatedAt to epoch", async () => {
    await seedUser();
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        lastSpotCreatedAt: Timestamp.fromMillis(0),
      }),
    );
  });

  it("legitimate: owner CAN advance lastSpotCreatedAt via serverTimestamp()", async () => {
    await seedUser();
    await assertSucceeds(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        lastSpotCreatedAt: serverTimestamp(),
      }),
    );
  });
});

describe("nudge_limits.lastNudgedAt — tamper guard", () => {
  it("attack: owner CANNOT create a nudge_limits doc with lastNudgedAt in the past", async () => {
    await assertFails(
      setDoc(doc(asOwner().firestore(), "nudge_limits", `${OWNER_UID}_${GAME_ID}`), {
        senderUid: OWNER_UID,
        gameId: GAME_ID,
        lastNudgedAt: Timestamp.fromMillis(0),
      }),
    );
  });

  it("attack: owner CANNOT update lastNudgedAt backward even after the 1-hour cooldown elapses", async () => {
    // Seed with lastNudgedAt 2 hours ago so the update rule's elapsed-time
    // gate is satisfied — without the new "== request.time" clamp the
    // attacker could rewrite to epoch and re-open the cooldown forever.
    await seedNudgeLimit();
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "nudge_limits", `${OWNER_UID}_${GAME_ID}`), {
        lastNudgedAt: Timestamp.fromMillis(0),
      }),
    );
  });

  it("legitimate: owner CAN create with lastNudgedAt == serverTimestamp()", async () => {
    await assertSucceeds(
      setDoc(doc(asOwner().firestore(), "nudge_limits", `${OWNER_UID}_${GAME_ID}`), {
        senderUid: OWNER_UID,
        gameId: GAME_ID,
        lastNudgedAt: serverTimestamp(),
      }),
    );
  });

  it("legitimate: owner CAN advance lastNudgedAt via serverTimestamp() once cooldown elapses", async () => {
    await seedNudgeLimit();
    await assertSucceeds(
      updateDoc(doc(asOwner().firestore(), "nudge_limits", `${OWNER_UID}_${GAME_ID}`), {
        lastNudgedAt: serverTimestamp(),
      }),
    );
  });
});
