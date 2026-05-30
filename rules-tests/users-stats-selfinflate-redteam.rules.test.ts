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
const ACTIVE_GAME_ID = "game-alice-active";
const FORFEIT_GAME_ID = "game-alice-forfeit-won";
const THIRD_PARTY_GAME_ID = "game-bob-vs-carol";

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
    // Non-terminal — caller must not be able to close stats against an
    // in-flight game even though Alice is recorded as the winner.
    await setDoc(doc(db, "games", ACTIVE_GAME_ID), {
      player1Uid: ALICE_UID,
      player2Uid: BOB_UID,
      status: "active",
      winner: ALICE_UID,
    });
    // Terminal-but-via-forfeit win — the positive case for the forfeit
    // branch of (status == 'complete' || status == 'forfeit').
    await setDoc(doc(db, "games", FORFEIT_GAME_ID), {
      player1Uid: ALICE_UID,
      player2Uid: BOB_UID,
      status: "forfeit",
      winner: ALICE_UID,
    });
    // Alice is NOT a participant — used to prove a third party can't
    // cite a game between two other users to inflate their stats.
    await setDoc(doc(db, "games", THIRD_PARTY_GAME_ID), {
      player1Uid: BOB_UID,
      player2Uid: "carol-uid",
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

  it("attack: owner CANNOT double-bump wins+losses citing a winning game", async () => {
    // One game can never make a player BOTH win and lose. The composite
    // bump relies on the impossibility of `game.winner == uid && game.winner != uid`
    // — the wins helper requires winner==uid, the losses helper requires
    // winner!=uid, so no single gid can satisfy both branches at once.
    await seed({ aliceWins: 0, aliceLosses: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 1,
        losses: 1,
        lastStatsGameId: WIN_GAME_ID,
      }),
    );
  });

  it("attack: owner CANNOT double-bump wins+losses citing a losing game", async () => {
    // Same composite attack as above, this time citing a game Alice lost.
    // The wins helper still demands winner==uid, which fails here, so the
    // composite write must be denied even though the losses side alone
    // would have been legitimate.
    await seed({ aliceWins: 0, aliceLosses: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 1,
        losses: 1,
        lastStatsGameId: LOSS_GAME_ID,
      }),
    );
  });

  it("attack: owner CANNOT pass a non-string lastStatsGameId (number)", async () => {
    // The `gid is string` guard in ownerCanCloseWins must reject numeric
    // ids — without it, get(/games/$(12345)) would coerce and might land
    // on a real game doc by accident.
    await seed({ aliceWins: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 1,
        lastStatsGameId: 12345,
      }),
    );
  });

  it("attack: owner CANNOT pass a null lastStatsGameId", async () => {
    // Null must fail the `gid is string` guard. The wins +1 path requires
    // a real backing game id — null cannot satisfy any of the helper's
    // conjuncts.
    await seed({ aliceWins: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 1,
        lastStatsGameId: null,
      }),
    );
  });

  it("attack: owner CANNOT pass an object lastStatsGameId", async () => {
    // Map values must fail the `gid is string` guard. Without the type
    // check a structured payload like {id: "..."} could trick the helper
    // into a get() that throws after some predicates have already passed.
    await seed({ aliceWins: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 1,
        lastStatsGameId: { id: WIN_GAME_ID },
      }),
    );
  });

  it("attack: owner CANNOT pass an empty-string lastStatsGameId", async () => {
    // Empty string passes `is string` but get(/games/"") resolves to an
    // invalid document path — the rule must deny rather than allow the
    // write through on a get() error.
    await seed({ aliceWins: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 1,
        lastStatsGameId: "",
      }),
    );
  });

  it("attack: owner CANNOT bump wins citing an in-flight (non-terminal) game", async () => {
    // ACTIVE_GAME_ID has status:'active' even though Alice is recorded as
    // the winner. The helper's status guard (complete|forfeit) must
    // reject — otherwise a player could pre-bump their counter mid-game.
    await seed({ aliceWins: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 1,
        lastStatsGameId: ACTIVE_GAME_ID,
      }),
    );
  });

  it("attack: third party CANNOT cite a game between two other users", async () => {
    // THIRD_PARTY_GAME_ID is Bob vs Carol. Alice is the signed-in caller
    // and not a participant. The `(uid == game.player1Uid || uid == game.player2Uid)`
    // guard must reject — otherwise any signed-in user could harvest
    // wins from arbitrary completed games.
    await seed({ aliceWins: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 1,
        lastStatsGameId: THIRD_PARTY_GAME_ID,
      }),
    );
  });

  it("attack: owner CANNOT piggyback wins+1 on a legitimate stance change without a gid", async () => {
    // Mixing a legitimately-mutable field (stance) with an illegal stats
    // bump must not bypass the helper — the wins branch evaluates
    // independently and demands a backing gid.
    await seed({ aliceWins: 0 });
    await assertFails(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        stance: "Goofy",
        wins: 1,
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

  it("legitimate: owner can bump wins by +1 when citing a forfeit-status win", async () => {
    // The helper's terminal-status guard accepts both 'complete' and
    // 'forfeit'. A win via opponent timeout is just as valid as a played
    // win and must close the same way — guarded here so a future tighten
    // of the status check can't silently break the forfeit path.
    await seed({ aliceWins: 0 });
    await assertSucceeds(
      updateDoc(doc(asAlice().firestore(), "users", ALICE_UID), {
        wins: 1,
        lastStatsGameId: FORFEIT_GAME_ID,
      }),
    );
  });
});
