/**
 * Users — post-backfill strict-rules regression tests.
 *
 * Production `users/{uid}` docs written BEFORE the April 2026 public/
 * private split carried five sensitive fields inline: email,
 * emailVerified, dob, parentalConsent, fcmTokens. From rollout until
 * the May 2026 backfill (scripts/migrate-users-private.mjs) completed,
 * the rules ran in a TRANSITIONAL form that accepted a sensitive field
 * on update IFF its value was unchanged from `resource.data` — needed
 * because `request.resource.data` is the MERGED post-write state and
 * legacy docs still carried those fields inline on every partial
 * update (wins++, stance change, etc.).
 *
 * The backfill is now complete in production. The rules have been
 * restored to the strict `!('X' in request.resource.data)` form on
 * update, matching the long-standing create rule. These tests prove
 * the strict regime correctly handles the legacy-doc shape:
 *
 *   1. A partial update against a (no-longer-realistic, but
 *      defence-in-depth) legacy-shaped doc — even one that ONLY
 *      touches a non-sensitive field — is now DENIED, because the
 *      merged request.resource.data carries the inline sensitive
 *      fields through and the strict guard rejects them. This is
 *      the intentional inverse of the transitional behaviour: any
 *      doc still carrying inline sensitive fields is broken until
 *      it's re-migrated.
 *   2. Any attempt to mutate or re-introduce a sensitive field is
 *      still DENIED (this branch was always denied, including under
 *      the transitional form).
 *   3. A post-backfill clean doc accepts strict writes.
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
import { doc, setDoc, updateDoc, setLogLevel } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-users-legacy-migration";

const OWNER_UID = "owner-uid";

let testEnv: RulesTestEnvironment;

function asOwner(): RulesTestContext {
  return testEnv.authenticatedContext(OWNER_UID, { email_verified: true });
}

/**
 * Seed a LEGACY-shaped public user doc — as it exists in production
 * today, before the backfill runs. All five sensitive fields present
 * at the top level alongside the normal public fields. Rules are
 * disabled for the seed so we can install the exact legacy shape
 * that pre-split clients would have written.
 */
async function seedLegacyPublicUser(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", OWNER_UID), {
      uid: OWNER_UID,
      username: "alice",
      stance: "Regular",
      wins: 3,
      losses: 2,
      // Legacy inline sensitive fields — these are the ones the
      // public/private split intends to move out. On partial updates,
      // request.resource.data will still carry every one of them.
      email: "alice@example.com",
      emailVerified: true,
      dob: "2000-01-15",
      parentalConsent: true,
      fcmTokens: ["legacy-token-1", "legacy-token-2"],
    });
  });
}

/**
 * Seed a CLEAN post-backfill public user doc — no sensitive fields
 * at the top level. This is the shape every doc will have after the
 * migration script runs (and will be the only shape any post-split
 * client write can create).
 */
async function seedCleanPublicUser(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", OWNER_UID), {
      uid: OWNER_UID,
      username: "alice",
      stance: "Regular",
      wins: 3,
      losses: 2,
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

describe("users/{uid} — strict post-backfill behaviour against legacy-shaped docs", () => {
  // These tests assert the strict rule's intentional behaviour: any
  // doc that still carries inline sensitive fields is rejected on
  // every partial update, because request.resource.data carries the
  // legacy fields through. After the May 2026 backfill, no such doc
  // should exist in production; this is defence-in-depth.

  it("post-backfill strict: wins++ against a legacy-shaped doc is DENIED (sensitive fields ride through)", async () => {
    await seedLegacyPublicUser();
    // Exact shape of updatePlayerStats (src/services/users.ts:305) on
    // a win: { wins: increment(1), lastStatsGameId: "g-123" }. When
    // Firestore merges that into the legacy doc,
    // request.resource.data carries every inline sensitive field,
    // and the strict guard rejects them.
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        wins: 4,
        lastStatsGameId: "g-123",
      }),
    );
  });

  it("post-backfill strict: stance change against a legacy-shaped doc is DENIED", async () => {
    await seedLegacyPublicUser();
    await assertFails(updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), { stance: "Goofy" }));
  });

  it("attack: changing email on a legacy doc is DENIED", async () => {
    await seedLegacyPublicUser();
    await assertFails(updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), { email: "attacker@evil.com" }));
  });

  it("attack: flipping emailVerified on a legacy doc is DENIED", async () => {
    await seedLegacyPublicUser();
    // Legacy value is true — flip to false.
    await assertFails(updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), { emailVerified: false }));
  });

  it("attack: mutating dob on a legacy doc is DENIED", async () => {
    await seedLegacyPublicUser();
    await assertFails(updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), { dob: "1999-01-01" }));
  });

  it("attack: revoking parentalConsent on a legacy doc is DENIED", async () => {
    await seedLegacyPublicUser();
    // Legacy value is true — flip to false.
    await assertFails(updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), { parentalConsent: false }));
  });

  it("attack: replacing fcmTokens on a legacy doc is DENIED", async () => {
    await seedLegacyPublicUser();
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        fcmTokens: ["attacker-injected"],
      }),
    );
  });

  it("attack: adding fcmTokens to a clean (post-backfill) doc is DENIED", async () => {
    await seedCleanPublicUser();
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        fcmTokens: ["tok-1"],
      }),
    );
  });

  it("attack: adding email to a clean (post-backfill) doc is DENIED", async () => {
    await seedCleanPublicUser();
    await assertFails(updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), { email: "alice@example.com" }));
  });

  it("legitimate: wins++ against a clean (post-backfill) doc SUCCEEDS", async () => {
    await seedCleanPublicUser();
    await assertSucceeds(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        wins: 4,
        lastStatsGameId: "g-123",
      }),
    );
  });
});
