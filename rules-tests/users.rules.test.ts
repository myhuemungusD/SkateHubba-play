/**
 * Users — post-backfill strict UPDATE guard for sensitive fields.
 *
 * After the May 2026 backfill (scripts/migrate-users-private.mjs)
 * removed every inline `email`, `emailVerified`, `dob`,
 * `parentalConsent`, and `fcmTokens` field from public user docs, the
 * `users/{uid}` UPDATE rule was tightened from the transitional
 * "allowed IFF unchanged from resource.data" form back to the strict
 * `!('X' in request.resource.data)` form — matching the long-standing
 * CREATE rule.
 *
 * Key behaviour change: the transitional form accepted a sensitive
 * field on update IFF its value matched what was stored. The strict
 * form rejects the field unconditionally — even when the value the
 * client sends matches resource.data exactly.
 *
 * These tests pin that strictness: for each of the five sensitive
 * fields, an authenticated owner write that re-sends the EXACT value
 * already stored is DENIED. Under the old relaxed rule each of these
 * cases would have SUCCEEDED, so they are the regression guard that
 * the strict form is in place.
 *
 * Companion suites:
 *   - rules-tests/users-private-redteam.rules.test.ts covers the
 *     simpler "add a sensitive field to a clean doc" denial (both
 *     forms always denied that path).
 *   - rules-tests/users-legacy-migration.rules.test.ts covers the
 *     defence-in-depth "partial update against a legacy-shaped doc
 *     is now denied" behaviour that fell out of the strict form.
 *
 * Run via:  npm run test:rules
 */
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
  type RulesTestContext,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { doc, setDoc, updateDoc, setLogLevel } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-users-strict-update";

const OWNER_UID = "owner-uid";

const STORED_EMAIL = "alice@example.com";
const STORED_EMAIL_VERIFIED = true;
const STORED_DOB = "2000-01-15";
const STORED_PARENTAL_CONSENT = true;
const STORED_FCM_TOKENS = ["legacy-token-1", "legacy-token-2"];

let testEnv: RulesTestEnvironment;

function asOwner(): RulesTestContext {
  return testEnv.authenticatedContext(OWNER_UID, { email_verified: true });
}

/**
 * Seed a doc that still carries every sensitive field inline. After
 * the backfill this shape should not exist in production, but we
 * install it under rules-disabled so we can prove the strict rule
 * denies even an exact-value re-send.
 */
async function seedLegacyShapedUser(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", OWNER_UID), {
      uid: OWNER_UID,
      username: "alice",
      stance: "Regular",
      wins: 3,
      losses: 2,
      email: STORED_EMAIL,
      emailVerified: STORED_EMAIL_VERIFIED,
      dob: STORED_DOB,
      parentalConsent: STORED_PARENTAL_CONSENT,
      fcmTokens: STORED_FCM_TOKENS,
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
  await seedLegacyShapedUser();
});

describe("users/{uid} — strict UPDATE denies sensitive fields even when value matches stored", () => {
  // One denial case per sensitive field. Each test sends the EXACT
  // value already in resource.data. The transitional rule would have
  // accepted these; the strict rule must reject them.

  it("attack: re-sending the stored email value on update is DENIED", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        email: STORED_EMAIL,
      }),
    );
  });

  it("attack: re-sending the stored emailVerified value on update is DENIED", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        emailVerified: STORED_EMAIL_VERIFIED,
      }),
    );
  });

  it("attack: re-sending the stored dob value on update is DENIED", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        dob: STORED_DOB,
      }),
    );
  });

  it("attack: re-sending the stored parentalConsent value on update is DENIED", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        parentalConsent: STORED_PARENTAL_CONSENT,
      }),
    );
  });

  it("attack: re-sending the stored fcmTokens list on update is DENIED", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        fcmTokens: STORED_FCM_TOKENS,
      }),
    );
  });
});
