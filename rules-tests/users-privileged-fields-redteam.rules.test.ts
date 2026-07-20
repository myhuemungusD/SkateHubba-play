/**
 * Users — privileged-field self-modify red-team tests (F2).
 *
 * The `users/{uid}` update rule layers two independent guards on
 * sensitive / immutable fields:
 *
 *   1. Per-field value-equality guards (legacy form), which accept a
 *      field in request.resource.data IFF the value is unchanged from
 *      resource.data. Needed during the public/private backfill so that
 *      legitimate writes (stance edits) against legacy docs still pass
 *      while old inline values ride along.
 *
 *   2. A comprehensive `affectedKeys().hasAny([...])` guard that DENIES
 *      any update whose diff includes one of the privileged fields. This
 *      is the F2 backstop — it closes createdAt-rewrite and, since the
 *      stats fan-out lockdown, ALSO covers wins / losses / lastStatsGameId
 *      (stats are server-only now: the applyGameStats Cloud Function is
 *      the sole writer). It provides defense-in-depth against a future
 *      typo in the per-field list.
 *
 * Trust-no-client: every privileged field gets a negative test that
 * proves the owner cannot self-mutate it — including wins / losses /
 * lastStatsGameId, even when the owner cites a real terminal game — plus
 * a positive test that proves legitimate non-privileged updates (stance
 * change) still succeed.
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
import { doc, serverTimestamp, setDoc, updateDoc, setLogLevel } from "firebase/firestore";
import { seedTerminatedGame } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-users-privileged-redteam";

const OWNER_UID = "owner-uid";

let testEnv: RulesTestEnvironment;

function asOwner(): RulesTestContext {
  return testEnv.authenticatedContext(OWNER_UID, { email_verified: true });
}

/**
 * Seed a CLEAN post-backfill public user doc — no sensitive fields
 * inline. This is the steady-state shape after the public/private
 * split. The privileged-field guard must reject every self-modify
 * attempt against this baseline.
 *
 * Includes `createdAt` and `isVerifiedPro` so the negative tests can
 * attempt to mutate values that genuinely exist on the stored doc.
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

  it("attack: owner CANNOT increment wins — even citing a game they really won", async () => {
    // Formerly legal (ownerCanCloseWins). Since the stats fan-out lockdown,
    // wins is in the affectedKeys().hasAny([...]) backstop, so a real
    // winning game no longer authorizes a client stat write.
    await seedTerminatedGame(testEnv, "g-win", {
      player1Uid: OWNER_UID,
      player2Uid: "opponent-uid",
      winner: OWNER_UID,
    });
    await assertFails(updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), { wins: 4, lastStatsGameId: "g-win" }));
  });

  it("attack: owner CANNOT increment losses — even citing a game they really lost", async () => {
    await seedTerminatedGame(testEnv, "g-loss", { player1Uid: OWNER_UID, player2Uid: "opponent-uid" });
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), { losses: 3, lastStatsGameId: "g-loss" }),
    );
  });

  it("attack: owner CANNOT advance lastStatsGameId (stats are server-only)", async () => {
    // The dead lastStatsGameId field is now in the immutable backstop; the
    // Cloud Function + admin backfill own all stats bookkeeping.
    await seedTerminatedGame(testEnv, "game-just-finished", {
      player1Uid: OWNER_UID,
      player2Uid: "opponent-uid",
      winner: OWNER_UID,
    });
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), { wins: 4, lastStatsGameId: "game-just-finished" }),
    );
  });

  it("legitimate: owner CAN write lastGameCreatedAt as the server time", async () => {
    await assertSucceeds(
      setDoc(doc(asOwner().firestore(), "users", OWNER_UID), { lastGameCreatedAt: serverTimestamp() }, { merge: true }),
    );
  });

  it("legacy-shaped doc with inline PII cannot be partially updated until migrated", async () => {
    // A doc carrying legacy inline sensitive fields (email/dob/etc on the
    // public document instead of in /users/{uid}/private/*) is effectively
    // read-only from the client until it is migrated. The strict presence
    // checks further down in the owner-update clause
    //   && !('email' in request.resource.data) && !('dob' in ...)
    // operate on the post-merge document state, so even a benign partial
    // update (a stance change) on a doc that still has `email` stored
    // produces `'email' in request.resource.data == true` → deny. This
    // isolates the PII guard (a stats write would now be denied on its own
    // by the wins/losses/lastStatsGameId backstop). It locks in the
    // migration invariant: callers must move PII into the /private
    // subcollection before they can resume writing the public doc.
    await testEnv.clearFirestore();
    await seedCleanPublicUser({
      email: "alice@example.com",
      emailVerified: true,
      dob: "2000-01-15",
      parentalConsent: true,
      fcmTokens: ["legacy-token"],
    });

    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        stance: "Goofy",
      }),
    );
  });
});
