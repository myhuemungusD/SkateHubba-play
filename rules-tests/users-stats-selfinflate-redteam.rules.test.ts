/**
 * Users — owner stats are immutable to clients (stats fan-out lockdown).
 *
 * History: the `/users/{uid}` owner-update branch used to allow a wins/
 * losses +1 when the same write advanced `lastStatsGameId` to a terminal
 * game the caller participated in (ownerCanCloseWins / ownerCanCloseLosses).
 * That client-side close-out — together with the peer branch — corrupted
 * production counters and has been removed.
 *
 * New model: stats are written EXCLUSIVELY server-side. The applyGameStats
 * Cloud Function (admin SDK, bypasses these rules) increments
 * users/{uid}.wins/.losses exactly once per terminal game, gated by a
 * `statsApplied` flag it sets transactionally on the game doc. The rules
 * therefore deny EVERY client write that changes wins, losses, or
 * lastStatsGameId — enforced by the owner-update
 * `affectedKeys().hasAny(['wins','losses','lastStatsGameId', …])` backstop.
 *
 * These tests pin the lockdown:
 *   - NEGATIVE: wins +1 WITH a valid backing game the caller won  → denied
 *     (the formerly-legal path is now rejected)
 *   - NEGATIVE: losses +1 WITH a valid backing game the caller lost → denied
 *   - NEGATIVE: wins +1 without lastStatsGameId                    → denied
 *   - NEGATIVE: wins +2 in a single write                          → denied
 *   - NEGATIVE: lastStatsGameId toggled alone                      → denied
 *   - NEGATIVE: wins decrement                                     → denied
 *   - NEGATIVE: seed wins from absent → 1                          → denied
 *   - POSITIVE: benign non-stats edit (stance)                     → succeeds
 *   - POSITIVE: rewriting stats to their SAME stored value (no diff) → succeeds
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

const PROJECT_ID = "demo-skatehubba-rules-users-selfinflate";

const ALICE_UID = "alice-uid";
const BOB_UID = "bob-uid";

const WIN_GAME_ID = "game-alice-won";
const LOSS_GAME_ID = "game-alice-lost";

let testEnv: RulesTestEnvironment;

function asAlice(): RulesTestContext {
  return testEnv.authenticatedContext(ALICE_UID, { email_verified: true });
}

/**
 * Seed Alice's user doc plus two completed games: one Alice won, one Alice
 * lost. The games exist so the tests can prove that EVEN a genuine terminal
 * game the caller participated in no longer authorizes a client stat write.
 */
async function seed(
  opts: {
    aliceWins?: number;
    aliceLosses?: number;
    aliceLastStatsGameId?: string | null;
  } = {},
): Promise<void> {
  const { aliceWins = 0, aliceLosses = 0, aliceLastStatsGameId = null } = opts;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const aliceDoc: Record<string, unknown> = {
      uid: ALICE_UID,
      username: "alice",
      stance: "Regular",
      wins: aliceWins,
      losses: aliceLosses,
    };
    if (aliceLastStatsGameId !== null) aliceDoc.lastStatsGameId = aliceLastStatsGameId;
    await setDoc(doc(db, "users", ALICE_UID), aliceDoc);

    await setDoc(doc(db, "games", WIN_GAME_ID), {
      player1Uid: ALICE_UID,
      player2Uid: BOB_UID,
      status: "complete",
      winner: ALICE_UID,
    });
    await setDoc(doc(db, "games", LOSS_GAME_ID), {
      player1Uid: ALICE_UID,
      player2Uid: BOB_UID,
      status: "complete",
      winner: BOB_UID,
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

describe("users/{uid} owner stats — every client stat write is DENIED", () => {
  it("denied: owner CANNOT bump wins +1 even citing a game they actually won", async () => {
    // This is the formerly-legal path (ownerCanCloseWins). Stats are now
    // server-only, so even with a real winning game it must fail closed.
    await seed({ aliceWins: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 1,
        lastStatsGameId: WIN_GAME_ID,
      }),
    );
  });

  it("denied: owner CANNOT bump losses +1 even citing a game they actually lost", async () => {
    await seed({ aliceLosses: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        losses: 1,
        lastStatsGameId: LOSS_GAME_ID,
      }),
    );
  });

  it("denied: owner CANNOT bump wins +1 without lastStatsGameId", async () => {
    await seed({ aliceWins: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 1,
      }),
    );
  });

  it("denied: owner CANNOT bump wins +2 in one write", async () => {
    await seed({ aliceWins: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 2,
        lastStatsGameId: WIN_GAME_ID,
      }),
    );
  });

  it("denied: owner CANNOT toggle lastStatsGameId alone", async () => {
    await seed({ aliceWins: 1, aliceLastStatsGameId: WIN_GAME_ID });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        lastStatsGameId: "G2-arbitrary",
      }),
    );
  });

  it("denied: owner CANNOT decrement wins", async () => {
    await seed({ aliceWins: 5 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 4,
        lastStatsGameId: WIN_GAME_ID,
      }),
    );
  });

  it("denied: owner CANNOT seed wins from absent → 1 on a doc with no stored wins", async () => {
    // resource.data has no `wins` key — the diff introduces one, so it lands
    // in affectedKeys() and the backstop denies it.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", ALICE_UID), {
        uid: ALICE_UID,
        username: "alice",
        stance: "Regular",
      });
    });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 1,
      }),
    );
  });
});

describe("users/{uid} owner stats — benign writes that don't change stats SUCCEED", () => {
  it("succeeds: benign profile edit (stance) with stats untouched", async () => {
    await seed({ aliceWins: 3, aliceLosses: 1, aliceLastStatsGameId: WIN_GAME_ID });
    await assertSucceeds(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        stance: "Goofy",
      }),
    );
  });

  it("succeeds: re-writing wins/losses to their SAME stored value is not a diff", async () => {
    // affectedKeys() only contains fields whose VALUE changes. Writing the
    // identical stored numbers alongside a benign edit produces no stat diff,
    // so the backstop lets it through. Proves the guard is value-based, not
    // presence-based — legacy docs stay writable for real profile edits.
    await seed({ aliceWins: 3, aliceLosses: 2 });
    await assertSucceeds(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        stance: "Goofy",
        wins: 3,
        losses: 2,
      }),
    );
  });

  it("succeeds: benign edit on a legacy doc still carrying lastStatsGameId (value unchanged)", async () => {
    // A legacy doc that predates the backfill may still carry
    // lastStatsGameId. A benign edit that doesn't touch it keeps working
    // because the value doesn't change → not in affectedKeys().
    await seed({ aliceWins: 4, aliceLastStatsGameId: "old-game" });
    await assertSucceeds(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        stance: "Goofy",
      }),
    );
  });
});
