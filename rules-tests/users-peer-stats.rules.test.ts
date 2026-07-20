/**
 * Users — peer stats close-out is now DENIED (stats fan-out lockdown).
 *
 * Background: when a SkateHubba game completes or is forfeited, BOTH
 * players' wins/losses counters need to advance. An earlier rules pass
 * added a second `allow update` branch on `/users/{uid}` gated by
 * `canPeerCloseStats(uid)` so either participant could close out the
 * OTHER participant's stats. That client fan-out (driven from the former
 * src/context/GameContext.tsx catch-up loop) corrupted production
 * counters and has been REMOVED.
 *
 * Stats are now written EXCLUSIVELY server-side: the applyGameStats Cloud
 * Function (admin SDK, bypasses these rules) increments
 * users/{uid}.wins/.losses exactly once per terminal game. There is no
 * longer any client write path to wins/losses/lastStatsGameId — the
 * owner-update affectedKeys().hasAny([...]) backstop denies the owner
 * touching them, and the peer branch is gone entirely.
 *
 * These tests pin the lockdown: every peer stat write is DENIED, in every
 * shape the old rule used to allow, and the owner cannot self-write stats
 * either. Benign non-stats owner edits still pass (control).
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

const PROJECT_ID = "demo-skatehubba-rules-users-peer-stats";

const ALICE_UID = "alice-uid";
const BOB_UID = "bob-uid";
const STRANGER_UID = "stranger-uid";

const GAME_ID = "game-1";

let testEnv: RulesTestEnvironment;

function asAlice(): RulesTestContext {
  return testEnv.authenticatedContext(ALICE_UID, { email_verified: true });
}

function asBob(): RulesTestContext {
  return testEnv.authenticatedContext(BOB_UID, { email_verified: true });
}

function asStranger(): RulesTestContext {
  return testEnv.authenticatedContext(STRANGER_UID, { email_verified: true });
}

/**
 * Seed both /users docs and a /games doc under rules-disabled. The game
 * defaults to a complete game won by Alice (so Bob is the loser whose
 * `losses` a peer write used to be able to close).
 */
async function seed(
  opts: {
    gameStatus?: "active" | "complete" | "forfeit";
    winner?: string | null;
    aliceWins?: number;
    aliceLosses?: number;
    bobWins?: number;
    bobLosses?: number;
  } = {},
): Promise<void> {
  const {
    gameStatus = "complete",
    winner = ALICE_UID,
    aliceWins = 0,
    aliceLosses = 0,
    bobWins = 0,
    bobLosses = 0,
  } = opts;

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", ALICE_UID), {
      uid: ALICE_UID,
      username: "alice",
      stance: "Regular",
      wins: aliceWins,
      losses: aliceLosses,
    });
    await setDoc(doc(db, "users", BOB_UID), {
      uid: BOB_UID,
      username: "bob",
      stance: "Regular",
      wins: bobWins,
      losses: bobLosses,
    });
    await setDoc(doc(db, "games", GAME_ID), {
      player1Uid: ALICE_UID,
      player2Uid: BOB_UID,
      status: gameStatus,
      winner,
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

describe("users/{uid} peer stats — every peer write is now DENIED", () => {
  it("denied: winner (Alice) CANNOT increment loser (Bob)'s losses (peer path removed)", async () => {
    await seed({ winner: ALICE_UID, bobLosses: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", BOB_UID), {
        losses: 1,
        lastStatsGameId: GAME_ID,
      }),
    );
  });

  it("denied: loser (Bob) CANNOT increment winner (Alice)'s wins (peer path removed)", async () => {
    await seed({ winner: ALICE_UID, aliceWins: 2 });
    await assertFails(
      updateDoc(doc(asBob().firestore(), "users", ALICE_UID), {
        wins: 3,
        lastStatsGameId: GAME_ID,
      }),
    );
  });

  it("denied: peer write is rejected on forfeit games too", async () => {
    await seed({ gameStatus: "forfeit", winner: ALICE_UID, bobLosses: 5 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", BOB_UID), {
        losses: 6,
        lastStatsGameId: GAME_ID,
      }),
    );
  });

  it("denied: peer cannot write another player's stats even citing a valid terminal game", async () => {
    // The former canPeerCloseStats helper accepted exactly this shape. With
    // the helper gone and no peer `allow update`, it must now fail closed.
    await seed({ winner: ALICE_UID, bobLosses: 3 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", BOB_UID), {
        losses: 4,
        lastStatsGameId: GAME_ID,
      }),
    );
  });

  it("denied: non-participant cannot write either player's stats", async () => {
    await seed({ winner: ALICE_UID });
    await assertFails(
      updateDoc(doc(asStranger().firestore(), "users", BOB_UID), {
        losses: 1,
        lastStatsGameId: GAME_ID,
      }),
    );
    await assertFails(
      updateDoc(doc(asStranger().firestore(), "users", ALICE_UID), {
        wins: 1,
        lastStatsGameId: GAME_ID,
      }),
    );
  });

  it("denied: peer cannot write while the game is still active", async () => {
    await seed({ gameStatus: "active", winner: null });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", BOB_UID), {
        losses: 1,
        lastStatsGameId: GAME_ID,
      }),
    );
  });

  it("denied: peer cannot piggyback an unrelated stats-shaped write onto another doc", async () => {
    await seed({ winner: ALICE_UID, bobLosses: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", BOB_UID), {
        losses: 1,
        lastStatsGameId: GAME_ID,
        username: "alice-stole-this",
      }),
    );
  });
});

describe("users/{uid} owner stats — owner self-writes are DENIED too", () => {
  it("denied: owner CANNOT increment their own wins even citing a game they won", async () => {
    // The former owner close-out branch (ownerCanCloseWins) is gone; the
    // affectedKeys().hasAny([...]) backstop now denies any wins change.
    await seed({ winner: ALICE_UID, aliceWins: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 1,
        lastStatsGameId: GAME_ID,
      }),
    );
  });

  it("denied: owner CANNOT advance lastStatsGameId on their own doc", async () => {
    await seed({ winner: ALICE_UID });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        lastStatsGameId: GAME_ID,
      }),
    );
  });

  it("control: owner CAN still make a benign non-stats profile edit", async () => {
    await seed({ winner: ALICE_UID, aliceWins: 3, aliceLosses: 1 });
    await assertSucceeds(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        stance: "Goofy",
      }),
    );
  });
});
