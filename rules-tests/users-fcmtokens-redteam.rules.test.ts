/**
 * Users.fcmTokens — red-team tests for the ≤10 cap and list-type check
 * added in the April 2026 hardening pass.
 *
 * Without this cap, a compromised client could stuff an unbounded blob
 * (or arbitrary non-list value) into the user doc under the guise of an
 * FCM registration update. The hardening now enforces fcmTokens is list
 * and size ≤ 10.
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
import { doc, setDoc, setLogLevel } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-users-fcm-redteam";

const OWNER_UID = "owner-uid";

let testEnv: RulesTestEnvironment;

function asOwner(): RulesTestContext {
  return testEnv.authenticatedContext(OWNER_UID, { email_verified: true });
}

/**
 * Seed the user doc under rules-disabled so we can isolate update-path
 * assertions from create-rule rejections (existence check, username
 * regex, etc.).
 */
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
  await seedUser();
});

describe("users.fcmTokens — red-team against ≤10 cap and list-type", () => {
  it("attack: owner CANNOT write 11 fcmTokens (one over the cap)", async () => {
    const tokens = Array.from({ length: 11 }, (_, i) => `token-${i}`);
    await assertFails(setDoc(doc(asOwner().firestore(), "users", OWNER_UID), makeUserUpdate({ fcmTokens: tokens })));
  });

  it("attack: owner CANNOT write fcmTokens as a string", async () => {
    await assertFails(
      setDoc(doc(asOwner().firestore(), "users", OWNER_UID), makeUserUpdate({ fcmTokens: "single-token-string" })),
    );
  });

  it("attack: owner CANNOT write fcmTokens as an object/map", async () => {
    await assertFails(
      setDoc(doc(asOwner().firestore(), "users", OWNER_UID), makeUserUpdate({ fcmTokens: { a: "tok" } })),
    );
  });

  it("legitimate: owner CAN write exactly 10 fcmTokens", async () => {
    const tokens = Array.from({ length: 10 }, (_, i) => `token-${i}`);
    await assertSucceeds(setDoc(doc(asOwner().firestore(), "users", OWNER_UID), makeUserUpdate({ fcmTokens: tokens })));
  });
});
