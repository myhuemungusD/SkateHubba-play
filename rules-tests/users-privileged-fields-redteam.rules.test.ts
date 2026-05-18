/**
 * Users — privileged-field self-modify red-team tests (F2 backstop).
 *
 * Negative: every privileged field is verifiably immutable by the owner.
 * Positive: legitimate non-privileged writes (stance, wins++, lastStatsGameId
 * advance, lastGameCreatedAt) still succeed, including against legacy-shaped
 * docs that carry inline sensitive fields.
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
import { doc, serverTimestamp, setDoc, updateDoc, setLogLevel } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-users-privileged-redteam";

const OWNER_UID = "owner-uid";

let testEnv: RulesTestEnvironment;

function asOwner(): RulesTestContext {
  return testEnv.authenticatedContext(OWNER_UID, { email_verified: true });
}

/**
 * Seed a clean post-backfill public user doc. `createdAt` and
 * `isVerifiedPro` are included so negative tests have real values to
 * attempt to overwrite.
 */
async function seedCleanPublicUser(overrides: Record<string, unknown> = {}): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", OWNER_UID), {
      uid: OWNER_UID,
      username: "alice",
      stance: "Regular",
      wins: 3,
      losses: 2,
      // serverTimestamp() so the stored value is a real Timestamp. The
      // negative createdAt test then attempts to overwrite it with a
      // different Timestamp via the same serverTimestamp() sentinel on
      // the next tick — guaranteed to land in affectedKeys().
      createdAt: serverTimestamp(),
      isVerifiedPro: false,
      verifiedBy: "admin-uid",
      verifiedAt: serverTimestamp(),
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
  await seedCleanPublicUser();
});

describe("users/{uid} — owner CANNOT self-modify privileged identity fields", () => {
  it("attack: owner CANNOT rewrite createdAt to a fresh server timestamp", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("attack: owner CANNOT change uid to another value", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        uid: "different-uid",
      }),
    );
  });

  it("attack: owner CANNOT change their username post-create", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        username: "bob",
      }),
    );
  });
});

describe("users/{uid} — owner CANNOT self-grant admin-only pro fields", () => {
  it("attack: owner CANNOT flip isVerifiedPro to true", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        isVerifiedPro: true,
      }),
    );
  });

  it("attack: owner CANNOT change verifiedBy to themselves", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        verifiedBy: OWNER_UID,
      }),
    );
  });

  it("attack: owner CANNOT rewrite verifiedAt to backdate their pro status", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        verifiedAt: serverTimestamp(),
      }),
    );
  });
});

describe("users/{uid} — owner CANNOT re-introduce sensitive PII fields", () => {
  // These overlap with users-private-redteam coverage but are repeated
  // here to prove the F2 affectedKeys() backstop covers them too. If a
  // future refactor accidentally weakens the per-field clauses, the
  // backstop must still hold.
  it("attack: owner CANNOT add email at top level (post-backfill clean doc)", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        email: "alice@example.com",
      }),
    );
  });

  it("attack: owner CANNOT add emailVerified at top level", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        emailVerified: true,
      }),
    );
  });

  it("attack: owner CANNOT add dob at top level", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        dob: "2000-01-15",
      }),
    );
  });

  it("attack: owner CANNOT add parentalConsent at top level", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        parentalConsent: true,
      }),
    );
  });

  it("attack: owner CANNOT add fcmTokens at top level", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        fcmTokens: ["forged-token"],
      }),
    );
  });
});

describe("users/{uid} — legitimate non-privileged updates still SUCCEED", () => {
  it("legitimate: owner CAN change stance without touching privileged fields", async () => {
    await assertSucceeds(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        stance: "Goofy",
      }),
    );
  });

  it("legitimate: owner CAN increment wins by exactly 1", async () => {
    await assertSucceeds(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        wins: 4,
      }),
    );
  });

  it("legitimate: owner CAN increment losses by exactly 1", async () => {
    await assertSucceeds(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        losses: 3,
      }),
    );
  });

  it("legitimate: owner CAN advance lastStatsGameId via the wins++ catch-up path", async () => {
    // updatePlayerStats() in src/services/users.ts writes
    // { wins: increment(1), lastStatsGameId: gameId } on the owner's
    // doc as the local-side idempotency key. The privileged-field
    // guard intentionally excludes lastStatsGameId so this path keeps
    // working — guarded by this regression test.
    await assertSucceeds(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        wins: 4,
        lastStatsGameId: "game-just-finished",
      }),
    );
  });

  it("legitimate: owner CAN write lastGameCreatedAt as the server time", async () => {
    await assertSucceeds(
      setDoc(doc(asOwner().firestore(), "users", OWNER_UID), { lastGameCreatedAt: serverTimestamp() }, { merge: true }),
    );
  });

  it("legitimate: partial wins++ update against a legacy-shaped doc still succeeds", async () => {
    // Re-seed with the legacy inline sensitive fields present, so the
    // merged request.resource.data carries email/dob/etc through the
    // write. The privileged-field guard must not affectedKeys()-flag
    // them because their VALUES are unchanged.
    await testEnv.clearFirestore();
    await seedCleanPublicUser({
      email: "alice@example.com",
      emailVerified: true,
      dob: "2000-01-15",
      parentalConsent: true,
      fcmTokens: ["legacy-token"],
    });

    await assertSucceeds(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        wins: 4,
      }),
    );
  });
});
