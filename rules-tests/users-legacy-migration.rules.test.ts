/**
 * Users — legacy-migration transitional-rules tests.
 *
 * Production `users/{uid}` docs written BEFORE the public/private
 * split carry five sensitive fields inline: email, emailVerified,
 * dob, parentalConsent, fcmTokens. Firestore's `request.resource.data`
 * is the MERGED post-write state, so any untouched legacy field
 * remains in `request.resource.data` on every partial update.
 *
 * The strict `!('X' in request.resource.data)` form of the rule would
 * therefore reject every legitimate partial write against a legacy
 * doc (wins++, stance change, etc.) until the backfill script
 * (scripts/migrate-users-private.mjs) runs. That's the deploy blocker
 * the prior audit flagged.
 *
 * The transitional form allows a sensitive field in
 * `request.resource.data` IFF the value is unchanged from
 * `resource.data`. These tests prove:
 *
 *   1. Legitimate wins++ against a legacy doc (with every sensitive
 *      field still inline) SUCCEEDS — the deploy blocker is lifted.
 *   2. Legitimate stance change against a legacy doc SUCCEEDS.
 *   3. Any attempt to MUTATE a sensitive field value (or ADD a new
 *      one) on the public doc is still DENIED.
 *   4. A post-backfill clean doc still accepts strict writes.
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

describe("users/{uid} — legacy-doc transitional behaviour (deploy-blocker regression)", () => {
  // These tests confirm the behaviour the prior audit predicted AND
  // the transitional rules then fix.

  it("legitimate: wins++ against a legacy doc with inline sensitive fields SUCCEEDS", async () => {
    await seedLegacyPublicUser();
    // Exact shape of updatePlayerStats (src/services/users.ts:305) on
    // a win: { wins: increment(1), lastStatsGameId: "g-123" }. When
    // Firestore merges that into the legacy doc,
    // request.resource.data carries every inline sensitive field.
    await assertSucceeds(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        wins: 4,
        lastStatsGameId: "g-123",
      }),
    );
  });

  it("legitimate: stance change against a legacy doc with inline sensitive fields SUCCEEDS", async () => {
    await seedLegacyPublicUser();
    await assertSucceeds(updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), { stance: "Goofy" }));
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
