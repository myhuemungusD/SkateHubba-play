/**
 * Users PII — red-team tests for the owner-only private-profile
 * subcollection split (April 2026). Push-notification tokens, date of
 * birth, and parental-consent flag must live at
 * `users/{uid}/private/profile` — the publicly readable `users/{uid}`
 * root rejects these fields outright so a regression can't leak them.
 *
 * The subcollection keeps the previous ≤10 cap and list-type check on
 * fcmTokens that the root field previously enforced.
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
import { doc, getDoc, setDoc, setLogLevel, updateDoc } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-users-fcm-redteam";

const OWNER_UID = "owner-uid";
const OTHER_UID = "stranger-uid";
const PROFILE_PATH = ["users", OWNER_UID, "private", "profile"] as const;

let testEnv: RulesTestEnvironment;

function asOwner(): RulesTestContext {
  return testEnv.authenticatedContext(OWNER_UID, { email_verified: true });
}

function asStranger(): RulesTestContext {
  return testEnv.authenticatedContext(OTHER_UID, { email_verified: true });
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

async function seedPrivateProfile(data: Record<string, unknown> = {}): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), ...PROFILE_PATH), data);
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

describe("users.{uid} root — PII fields are rejected outright", () => {
  it("attack: owner CANNOT write fcmTokens on the public users/{uid} doc", async () => {
    await assertFails(setDoc(doc(asOwner().firestore(), "users", OWNER_UID), makeUserUpdate({ fcmTokens: ["tok1"] })));
  });

  it("attack: owner CANNOT write dob on the public users/{uid} doc", async () => {
    await assertFails(setDoc(doc(asOwner().firestore(), "users", OWNER_UID), makeUserUpdate({ dob: "2000-01-01" })));
  });

  it("attack: owner CANNOT write parentalConsent on the public users/{uid} doc", async () => {
    await assertFails(
      setDoc(doc(asOwner().firestore(), "users", OWNER_UID), makeUserUpdate({ parentalConsent: true })),
    );
  });
});

describe("users/{uid}/private/profile — owner-only read", () => {
  it("owner CAN read their own private profile", async () => {
    await seedPrivateProfile({ fcmTokens: ["tok1"] });
    await assertSucceeds(getDoc(doc(asOwner().firestore(), ...PROFILE_PATH)));
  });

  it("attack: a stranger CANNOT read another user's private profile", async () => {
    await seedPrivateProfile({ fcmTokens: ["tok1"], dob: "2000-01-01" });
    await assertFails(getDoc(doc(asStranger().firestore(), ...PROFILE_PATH)));
  });
});

describe("users/{uid}/private/profile — write guards", () => {
  it("attack: owner CANNOT write 11 fcmTokens (one over the cap)", async () => {
    const tokens = Array.from({ length: 11 }, (_, i) => `token-${i}`);
    await assertFails(setDoc(doc(asOwner().firestore(), ...PROFILE_PATH), { fcmTokens: tokens }));
  });

  it("attack: owner CANNOT write fcmTokens as a string", async () => {
    await assertFails(setDoc(doc(asOwner().firestore(), ...PROFILE_PATH), { fcmTokens: "single-token-string" }));
  });

  it("attack: owner CANNOT write fcmTokens as an object/map", async () => {
    await assertFails(setDoc(doc(asOwner().firestore(), ...PROFILE_PATH), { fcmTokens: { a: "tok" } }));
  });

  it("legitimate: owner CAN write exactly 10 fcmTokens", async () => {
    const tokens = Array.from({ length: 10 }, (_, i) => `token-${i}`);
    await assertSucceeds(setDoc(doc(asOwner().firestore(), ...PROFILE_PATH), { fcmTokens: tokens }));
  });

  it("legitimate: owner CAN write dob + parentalConsent on create", async () => {
    await assertSucceeds(
      setDoc(doc(asOwner().firestore(), ...PROFILE_PATH), {
        dob: "2000-01-01",
        parentalConsent: false,
      }),
    );
  });

  it("attack: owner CANNOT write a malformed dob (non-ISO)", async () => {
    await assertFails(setDoc(doc(asOwner().firestore(), ...PROFILE_PATH), { dob: "01/01/2000" }));
  });

  it("attack: owner CANNOT rewrite dob after creation (COPPA audit trail)", async () => {
    await seedPrivateProfile({ dob: "2000-01-01" });
    await assertFails(updateDoc(doc(asOwner().firestore(), ...PROFILE_PATH), { dob: "2010-06-15" }));
  });

  it("attack: owner CANNOT rewrite parentalConsent after creation", async () => {
    await seedPrivateProfile({ dob: "2010-06-15", parentalConsent: true });
    await assertFails(updateDoc(doc(asOwner().firestore(), ...PROFILE_PATH), { parentalConsent: false }));
  });

  it("attack: a stranger CANNOT write to another user's private profile", async () => {
    await assertFails(setDoc(doc(asStranger().firestore(), ...PROFILE_PATH), { fcmTokens: ["stranger-token"] }));
  });

  it("attack: owner CANNOT create private/foo — only docId='profile' is allowed", async () => {
    await assertFails(setDoc(doc(asOwner().firestore(), "users", OWNER_UID, "private", "foo"), { fcmTokens: ["tok"] }));
  });
});
