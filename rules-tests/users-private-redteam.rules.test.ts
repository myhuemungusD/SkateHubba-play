/**
 * Users — cross-user privacy split red-team tests.
 *
 * Before this rules pass, `users/{uid}` was readable by every signed-
 * in user AND carried `fcmTokens`, `email`, `dob`, `emailVerified`,
 * `parentalConsent` inline. Any signed-in attacker could scrape those
 * fields for any other user. The fix moves them to the owner-only
 * `users/{uid}/private/{docId}` subcollection and forbids them at the
 * top level of the public doc.
 *
 * These tests verify:
 *   1. A non-owner CANNOT read users/{otherUid}/private/profile.
 *   2. The owner CAN read and write their own private doc.
 *   3. Creating users/{uid} with a sensitive field at the top level
 *      is DENIED.
 *   4. Updating users/{uid} to re-add a sensitive field at the top
 *      level is DENIED.
 *   5. fcmTokens list cap (≤10 entries, must be a list) still holds,
 *      now on the private doc instead of the public one.
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
import { doc, deleteDoc, getDoc, setDoc, updateDoc, setLogLevel } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-users-private-redteam";

const OWNER_UID = "owner-uid";
const STRANGER_UID = "stranger-uid";

let testEnv: RulesTestEnvironment;

function asOwner(): RulesTestContext {
  return testEnv.authenticatedContext(OWNER_UID, { email_verified: true });
}

function asStranger(): RulesTestContext {
  return testEnv.authenticatedContext(STRANGER_UID, { email_verified: true });
}

/**
 * Seed a clean public user doc under rules-disabled. Tests then
 * exercise the update and private-subcollection paths against the
 * real rules.
 */
async function seedPublicUser(overrides: Record<string, unknown> = {}): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", OWNER_UID), {
      uid: OWNER_UID,
      username: "alice",
      stance: "Regular",
      wins: 0,
      losses: 0,
      ...overrides,
    });
  });
}

async function seedPrivateDoc(data: Record<string, unknown>): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", OWNER_UID, "private", "profile"), data);
  });
}

function publicUserUpdate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: OWNER_UID,
    username: "alice",
    stance: "Regular",
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
  await seedPublicUser();
});

describe("users/{uid}/private — cross-user read isolation", () => {
  it("attack: a stranger CANNOT read another user's private profile doc", async () => {
    await seedPrivateDoc({
      emailVerified: true,
      email: "alice@example.com",
      dob: "2000-01-15",
      fcmTokens: ["tok-1", "tok-2"],
    });

    await assertFails(getDoc(doc(asStranger().firestore(), "users", OWNER_UID, "private", "profile")));
  });

  it("attack: a stranger CANNOT write to another user's private profile doc", async () => {
    await assertFails(
      setDoc(doc(asStranger().firestore(), "users", OWNER_UID, "private", "profile"), {
        fcmTokens: ["attacker-injected"],
      }),
    );
  });

  it("attack: a stranger CANNOT delete another user's private profile doc", async () => {
    await seedPrivateDoc({ emailVerified: true });
    await assertFails(deleteDoc(doc(asStranger().firestore(), "users", OWNER_UID, "private", "profile")));
  });

  it("legitimate: owner CAN read their own private profile doc", async () => {
    await seedPrivateDoc({ emailVerified: true, dob: "2000-01-15" });
    await assertSucceeds(getDoc(doc(asOwner().firestore(), "users", OWNER_UID, "private", "profile")));
  });

  it("legitimate: owner CAN create their own private profile doc", async () => {
    await assertSucceeds(
      setDoc(doc(asOwner().firestore(), "users", OWNER_UID, "private", "profile"), {
        emailVerified: true,
        dob: "2000-01-15",
      }),
    );
  });

  it("legitimate: owner CAN update their own private profile doc", async () => {
    await seedPrivateDoc({ emailVerified: false, dob: "2000-01-15" });
    await assertSucceeds(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID, "private", "profile"), {
        emailVerified: true,
        fcmTokens: ["device-1"],
      }),
    );
  });
});

describe("users/{uid} — sensitive fields forbidden at top level on CREATE", () => {
  // These tests bypass seedPublicUser (create rule requires no existing
  // doc) by clearing Firestore first. The create path is the exact
  // code-path createProfile() now takes — no sensitive fields inline.
  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  it("attack: CANNOT create users/{uid} with email at top level", async () => {
    await assertFails(
      setDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        uid: OWNER_UID,
        username: "alice",
        stance: "Regular",
        email: "alice@example.com",
      }),
    );
  });

  it("attack: CANNOT create users/{uid} with emailVerified at top level", async () => {
    await assertFails(
      setDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        uid: OWNER_UID,
        username: "alice",
        stance: "Regular",
        emailVerified: true,
      }),
    );
  });

  it("attack: CANNOT create users/{uid} with dob at top level", async () => {
    await assertFails(
      setDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        uid: OWNER_UID,
        username: "alice",
        stance: "Regular",
        dob: "2000-01-15",
      }),
    );
  });

  it("attack: CANNOT create users/{uid} with parentalConsent at top level", async () => {
    await assertFails(
      setDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        uid: OWNER_UID,
        username: "alice",
        stance: "Regular",
        parentalConsent: true,
      }),
    );
  });

  it("attack: CANNOT create users/{uid} with fcmTokens at top level", async () => {
    await assertFails(
      setDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        uid: OWNER_UID,
        username: "alice",
        stance: "Regular",
        fcmTokens: ["tok-1"],
      }),
    );
  });

  it("legitimate: CAN create users/{uid} with only safe cross-user fields", async () => {
    await assertSucceeds(
      setDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        uid: OWNER_UID,
        username: "alice",
        stance: "Regular",
      }),
    );
  });
});

describe("users/{uid} — sensitive fields forbidden at top level on UPDATE", () => {
  it("attack: CANNOT update users/{uid} to add email at top level", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), { email: "alice@example.com" }),
    );
  });

  it("attack: CANNOT update users/{uid} to add emailVerified at top level", async () => {
    await assertFails(updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), { emailVerified: true }));
  });

  it("attack: CANNOT update users/{uid} to add dob at top level", async () => {
    await assertFails(updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), { dob: "2000-01-15" }));
  });

  it("attack: CANNOT update users/{uid} to add parentalConsent at top level", async () => {
    await assertFails(updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), { parentalConsent: true }));
  });

  it("attack: CANNOT update users/{uid} to add fcmTokens at top level", async () => {
    await assertFails(updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), { fcmTokens: ["tok-1"] }));
  });

  it("legitimate: owner CAN update stats on users/{uid} without sensitive fields", async () => {
    await assertSucceeds(updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), { wins: 1 }));
  });
});

describe("users/{uid}/private — fcmTokens list cap moves with the field", () => {
  it("attack: owner CANNOT write 11 fcmTokens on the private doc (one over the cap)", async () => {
    const tokens = Array.from({ length: 11 }, (_, i) => `token-${i}`);
    await assertFails(
      setDoc(doc(asOwner().firestore(), "users", OWNER_UID, "private", "profile"), { fcmTokens: tokens }),
    );
  });

  it("attack: owner CANNOT write fcmTokens as a string on the private doc", async () => {
    await assertFails(
      setDoc(doc(asOwner().firestore(), "users", OWNER_UID, "private", "profile"), {
        fcmTokens: "single-token-string",
      }),
    );
  });

  it("legitimate: owner CAN write exactly 10 fcmTokens on the private doc", async () => {
    const tokens = Array.from({ length: 10 }, (_, i) => `token-${i}`);
    await assertSucceeds(
      setDoc(doc(asOwner().firestore(), "users", OWNER_UID, "private", "profile"), { fcmTokens: tokens }),
    );
  });
});
