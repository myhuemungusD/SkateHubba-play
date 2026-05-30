/**
 * Users — owner self-inflate red team for wins/losses.
 *
 * Audit finding: the `/users/{uid}` owner-update branch constrained the
 * wins/losses delta to ≤+1 per write but had NO idempotency check — no
 * `lastStatsGameId` guard, no game-relation check. The peer-update branch
 * (`canPeerCloseStats`) correctly enforces `resource.data.lastStatsGameId
 * != gid` for forward progress and a game-doc relational check, but the
 * owner branch silently dropped both guards.
 *
 * Impact: any signed-in user could call `updateDoc({wins: stored + 1})`
 * in a tight loop and inflate their leaderboard rank arbitrarily.
 *
 * Fix: tighten the owner branch so that ANY wins/losses change must be
 * either (a) unchanged, or (b) exactly +1 AND the same write advances
 * `lastStatsGameId` to a complete/forfeit game where the caller is a
 * participant and the recorded winner matches the side being claimed.
 *
 * These tests pin the new tightening:
 *   - NEGATIVE: +1 without lastStatsGameId        → denied
 *   - NEGATIVE: +1 with stale lastStatsGameId     → denied (replay)
 *   - NEGATIVE: +1 with nonexistent gid           → denied
 *   - NEGATIVE: wins +1 on a game the caller lost → denied
 *   - NEGATIVE: losses +1 on a game the caller won → denied
 *   - NEGATIVE: +2 in a single write              → denied (existing)
 *   - POSITIVE: wins +1 with valid winning game   → succeeds
 *   - POSITIVE: losses +1 with valid losing game  → succeeds
 *   - REPLAY:   same gid submitted twice          → second denied
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
 * Seed Alice's user doc plus two completed games: one Alice won, one Alice lost.
 * `aliceLastStatsGameId` lets tests stage the doc as if it already closed a
 * given gid (for replay/forward-progress cases).
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

describe("users/{uid} owner stats — self-inflate denials", () => {
  it("attack: owner CANNOT bump wins by +1 without lastStatsGameId", async () => {
    await seed({ aliceWins: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 1,
      }),
    );
  });

  it("attack: owner CANNOT bump losses by +1 without lastStatsGameId", async () => {
    await seed({ aliceLosses: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        losses: 1,
      }),
    );
  });

  it("attack: owner CANNOT bump wins citing a game they did NOT win", async () => {
    await seed({ aliceWins: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 1,
        lastStatsGameId: LOSS_GAME_ID,
      }),
    );
  });

  it("attack: owner CANNOT bump losses citing a game they did NOT lose", async () => {
    await seed({ aliceLosses: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        losses: 1,
        lastStatsGameId: WIN_GAME_ID,
      }),
    );
  });

  it("attack: owner CANNOT bump wins citing a nonexistent game doc", async () => {
    await seed({ aliceWins: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 1,
        lastStatsGameId: "nonexistent-game",
      }),
    );
  });

  it("attack: owner CANNOT bump losses citing a nonexistent game doc", async () => {
    await seed({ aliceLosses: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        losses: 1,
        lastStatsGameId: "nonexistent-game",
      }),
    );
  });

  it("attack: owner CANNOT bump wins by +2 in one write", async () => {
    await seed({ aliceWins: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 2,
        lastStatsGameId: WIN_GAME_ID,
      }),
    );
  });

  it("attack: owner CANNOT seed wins=1 on a brand-new (no-stored) field without a backing game", async () => {
    // resource.data has no `wins` key at all — old rule accepted 0 or 1 freely.
    // New rule must still demand a backing game for the "1" value.
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

  it("attack: owner CANNOT replay the same lastStatsGameId twice", async () => {
    // Alice's doc already records WIN_GAME_ID as last closed. Second close
    // attempt must be rejected by the forward-progress check.
    await seed({ aliceWins: 1, aliceLastStatsGameId: WIN_GAME_ID });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 2,
        lastStatsGameId: WIN_GAME_ID,
      }),
    );
  });
});

describe("users/{uid} owner stats — legitimate writes still succeed", () => {
  it("legitimate: owner can bump wins by +1 when citing a game they won", async () => {
    await seed({ aliceWins: 0 });
    await assertSucceeds(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 1,
        lastStatsGameId: WIN_GAME_ID,
      }),
    );
  });

  it("legitimate: owner can bump losses by +1 when citing a game they lost", async () => {
    await seed({ aliceLosses: 0 });
    await assertSucceeds(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        losses: 1,
        lastStatsGameId: LOSS_GAME_ID,
      }),
    );
  });

  it("legitimate: owner can write an unrelated update without touching wins/losses or lastStatsGameId", async () => {
    // No wins/losses delta, no lastStatsGameId — the tightened branch must
    // still permit benign profile updates (e.g. stance change).
    await seed({ aliceWins: 3, aliceLosses: 1, aliceLastStatsGameId: WIN_GAME_ID });
    await assertSucceeds(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        stance: "Goofy",
      }),
    );
  });
});

/**
 * Codex P1 follow-up: toggle-bypass replay.
 *
 * The previous fix only validated the +1 sub-branches; the "unchanged stat"
 * sub-branch silently permitted mutating `lastStatsGameId` alone. That broke
 * the forward-progress invariant — an attacker could toggle the idempotency
 * key to a junk value between two replays of the same legitimate win, so
 * ownerCanCloseWins's `resource.data.lastStatsGameId != gid` check stayed
 * green every time. These tests pin the new top-level guard that forbids
 * any `lastStatsGameId` change unless it rides along with a stat advance
 * that ownerCanCloseWins/Losses validates against the game doc.
 */
describe("users/{uid} owner stats — lastStatsGameId toggle-bypass guard", () => {
  it("attack: owner CANNOT toggle lastStatsGameId alone with no wins/losses change", async () => {
    // Stage Alice as if she has already legitimately closed WIN_GAME_ID.
    // The toggle write attempts to advance the key to an arbitrary string
    // without touching wins/losses — must fail.
    await seed({ aliceWins: 1, aliceLastStatsGameId: WIN_GAME_ID });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        lastStatsGameId: "G2-arbitrary",
      }),
    );
  });

  it("attack: full 3-step replay is severed at step 2 (the toggle)", async () => {
    // Step 1 is the legitimate close — succeeds and establishes the stored
    // lastStatsGameId == WIN_GAME_ID. Step 2 (the toggle) must now fail,
    // which prevents step 3 from ever satisfying the forward-progress check.
    await seed({ aliceWins: 0 });
    const aliceDb = asAlice().firestore();
    // Step 1: legitimate close.
    await assertSucceeds(
      updateDoc(doc(aliceDb, "users", ALICE_UID), {
        wins: 1,
        lastStatsGameId: WIN_GAME_ID,
      }),
    );
    // Step 2: toggle alone to bypass forward-progress on a future replay.
    await assertFails(
      updateDoc(doc(aliceDb, "users", ALICE_UID), {
        lastStatsGameId: "anything-else",
      }),
    );
  });

  it("legitimate: paired wins +1 with new lastStatsGameId still succeeds", async () => {
    // Sanity: the guard must not regress the legitimate close-out path.
    await seed({ aliceWins: 0 });
    await assertSucceeds(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 1,
        lastStatsGameId: WIN_GAME_ID,
      }),
    );
  });

  it("legitimate: benign edit with no lastStatsGameId in payload still succeeds", async () => {
    // Sanity: the guard is gated on `'lastStatsGameId' in request.resource.data`,
    // so writes that don't touch the field must pay nothing.
    await seed({ aliceWins: 2, aliceLastStatsGameId: WIN_GAME_ID });
    await assertSucceeds(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        stance: "Goofy",
      }),
    );
  });
});
