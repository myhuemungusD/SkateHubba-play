/**
 * Firestore rules tests for COPPA enforcement on /users/{uid} creation.
 *
 * The client-side AgeGate screen rejects under-13 signups, but security
 * rules are the real boundary — a hostile client can skip the React
 * component and call setDoc directly. These tests lock in:
 *
 *   • create requires a `dob` field
 *   • dob must be a YYYY-MM-DD string (shape check rejects malformed input)
 *   • users under 13 (by request.time) are denied
 *   • users exactly 13 or older are allowed
 *   • dob is immutable once the profile exists — you can't claim a
 *     different age after the fact to unlock under-13 features
 *   • pre-COPPA profiles (no dob) can still update without adding one
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
import { doc, setDoc, updateDoc, serverTimestamp, setLogLevel } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-users-coppa";

const UID = "u-alice";

let testEnv: RulesTestEnvironment;

function asUser(): RulesTestContext {
  return testEnv.authenticatedContext(UID, { email_verified: true });
}

function userRef(ctx: RulesTestContext) {
  return doc(ctx.firestore(), "users", UID);
}

function makeValidProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  // dob chosen to be safely over 13 relative to any realistic test clock.
  return {
    uid: UID,
    username: "alice",
    stance: "regular",
    emailVerified: true,
    dob: "2000-01-01",
    createdAt: serverTimestamp(),
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

describe("users/{uid} COPPA — create", () => {
  it("allows creation when dob shows user is clearly over 13", async () => {
    await assertSucceeds(setDoc(userRef(asUser()), makeValidProfile({ dob: "1995-06-15" })));
  });

  it("allows creation with parentalConsent carried for 13–17 users", async () => {
    // ~14 years old if test clock is near 2026.
    await assertSucceeds(setDoc(userRef(asUser()), makeValidProfile({ dob: "2012-01-01", parentalConsent: true })));
  });

  it("denies creation when dob is missing", async () => {
    const { dob: _dob, ...noDob } = makeValidProfile();
    await assertFails(setDoc(userRef(asUser()), noDob));
  });

  it("denies creation when dob is null", async () => {
    await assertFails(setDoc(userRef(asUser()), makeValidProfile({ dob: null })));
  });

  it("denies creation when dob is not a string", async () => {
    await assertFails(setDoc(userRef(asUser()), makeValidProfile({ dob: 20000101 })));
  });

  it("denies creation when dob is an invalid shape (missing day)", async () => {
    await assertFails(setDoc(userRef(asUser()), makeValidProfile({ dob: "2000-01" })));
  });

  it("denies creation when dob has an invalid month", async () => {
    await assertFails(setDoc(userRef(asUser()), makeValidProfile({ dob: "2000-13-01" })));
  });

  it("denies creation when dob has an invalid day", async () => {
    await assertFails(setDoc(userRef(asUser()), makeValidProfile({ dob: "2000-01-32" })));
  });

  it("denies creation when user is clearly under 13 (dob = today year)", async () => {
    // Using the current calendar year guarantees the user is 0 years old
    // regardless of test clock drift.
    const thisYear = new Date().getFullYear();
    await assertFails(setDoc(userRef(asUser()), makeValidProfile({ dob: `${thisYear}-01-01` })));
  });

  it("denies creation when user is 12 years and 364 days old", async () => {
    // One day shy of 13 relative to request.time — the month/day tie-breaker
    // in isOver13() must reject this.
    const now = new Date();
    const dob = new Date(now.getFullYear() - 13, now.getMonth(), now.getDate() + 1);
    const yyyy = dob.getFullYear();
    const mm = String(dob.getMonth() + 1).padStart(2, "0");
    const dd = String(dob.getDate()).padStart(2, "0");
    await assertFails(setDoc(userRef(asUser()), makeValidProfile({ dob: `${yyyy}-${mm}-${dd}` })));
  });

  it("allows creation when user turns 13 today", async () => {
    const now = new Date();
    const dob = new Date(now.getFullYear() - 13, now.getMonth(), now.getDate());
    const yyyy = dob.getFullYear();
    const mm = String(dob.getMonth() + 1).padStart(2, "0");
    const dd = String(dob.getDate()).padStart(2, "0");
    await assertSucceeds(setDoc(userRef(asUser()), makeValidProfile({ dob: `${yyyy}-${mm}-${dd}` })));
  });

  it("denies creation when parentalConsent is not a boolean", async () => {
    await assertFails(setDoc(userRef(asUser()), makeValidProfile({ dob: "2012-01-01", parentalConsent: "yes" })));
  });
});

describe("users/{uid} COPPA — update", () => {
  async function seedProfile(overrides: Record<string, unknown> = {}): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", UID), makeValidProfile(overrides));
    });
  }

  it("allows updates that preserve dob", async () => {
    await seedProfile({ dob: "2000-01-01" });
    await assertSucceeds(updateDoc(userRef(asUser()), { stance: "goofy" }));
  });

  it("denies updates that change dob", async () => {
    await seedProfile({ dob: "2000-01-01" });
    await assertFails(updateDoc(userRef(asUser()), { dob: "1990-01-01" }));
  });

  it("denies updates that remove dob", async () => {
    // Firestore has no first-class "remove field" in updateDoc; callers
    // would need deleteField(). We simulate the worst-case: client tries
    // to overwrite with a setDoc lacking dob. merge:false would bypass the
    // rule if we didn't enforce equality on dob presence.
    await seedProfile({ dob: "2000-01-01" });
    const { dob: _dob, ...noDob } = makeValidProfile({ dob: "2000-01-01" });
    await assertFails(setDoc(userRef(asUser()), noDob));
  });

  it("allows pre-COPPA profiles (no dob) to update without adding one", async () => {
    // Legacy profiles created before the COPPA rule keep working — the
    // rule only requires dob on CREATE. The update rule's dob branch
    // handles (absent-before, absent-after) as a no-op.
    const { dob: _dob, ...legacy } = makeValidProfile({ dob: "2000-01-01" });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", UID), legacy);
    });
    await assertSucceeds(updateDoc(userRef(asUser()), { stance: "goofy" }));
  });
});
