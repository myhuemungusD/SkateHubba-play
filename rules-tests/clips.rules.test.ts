/**
 * Firestore rules tests for the clips (landed-trick feed) collection.
 *
 * Clips are denormalized from games.turnHistory and gate the app's
 * cross-game feed. The rules must:
 *   • allow any signed-in user to read (feed is app-wide)
 *   • require the writer to be a participant of the referenced game
 *   • enforce a deterministic `${gameId}_${turnNumber}_${role}` doc id
 *   • validate shape (field types, bounded string sizes, role enum)
 *   • refuse updates and deletes (clips are immutable once written)
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
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  serverTimestamp,
  setLogLevel,
  writeBatch,
  runTransaction,
} from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-clips";

const P1_UID = "p1-alice";
const P2_UID = "p2-bob";
const JUDGE_UID = "j-judge";
const STRANGER_UID = "s-stranger";

const GAME_ID = "game1";
const TURN_NUMBER = 3;

let testEnv: RulesTestEnvironment;

function makeValidGame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    player1Uid: P1_UID,
    player2Uid: P2_UID,
    player1Username: "alice",
    player2Username: "bob",
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    currentTurn: P1_UID,
    phase: "setting",
    currentSetter: P1_UID,
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnNumber: 1,
    winner: null,
    turnHistory: [],
    turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function makeValidClip(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gameId: GAME_ID,
    turnNumber: TURN_NUMBER,
    role: "set",
    playerUid: P1_UID,
    playerUsername: "alice",
    trickName: "tre flip",
    videoUrl: "https://example.com/clip.webm",
    spotId: null,
    createdAt: serverTimestamp(),
    moderationStatus: "active",
    upvoteCount: 0,
    ...overrides,
  };
}

function deterministicId(gameId: string = GAME_ID, turnNumber: number = TURN_NUMBER, role: string = "set"): string {
  return `${gameId}_${turnNumber}_${role}`;
}

function asP1(): RulesTestContext {
  return testEnv.authenticatedContext(P1_UID, { email_verified: true });
}

function asP2(): RulesTestContext {
  return testEnv.authenticatedContext(P2_UID, { email_verified: true });
}

function asJudge(): RulesTestContext {
  return testEnv.authenticatedContext(JUDGE_UID, { email_verified: true });
}

function asStranger(): RulesTestContext {
  return testEnv.authenticatedContext(STRANGER_UID, { email_verified: true });
}

function asAnonymous(): RulesTestContext {
  return testEnv.unauthenticatedContext();
}

function clipRef(ctx: RulesTestContext, id: string) {
  return doc(ctx.firestore(), "clips", id);
}

async function seedGame(overrides: Record<string, unknown> = {}): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "games", GAME_ID), makeValidGame(overrides));
  });
}

async function seedClip(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = deterministicId(
    (overrides.gameId as string) ?? GAME_ID,
    (overrides.turnNumber as number) ?? TURN_NUMBER,
    (overrides.role as string) ?? "set",
  );
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "clips", id), makeValidClip(overrides));
  });
  return id;
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
  await seedGame();
});

/* ────────────────────────────────────────────
 * READ
 * ──────────────────────────────────────────── */

describe("clips — read", () => {
  it("any signed-in user CAN read clips (feed is app-wide)", async () => {
    await seedClip();
    await assertSucceeds(getDoc(clipRef(asStranger(), deterministicId())));
  });

  it("both players can read their own game's clips", async () => {
    await seedClip();
    await assertSucceeds(getDoc(clipRef(asP1(), deterministicId())));
    await assertSucceeds(getDoc(clipRef(asP2(), deterministicId())));
  });

  it("anonymous users CANNOT read clips", async () => {
    await seedClip();
    await assertFails(getDoc(clipRef(asAnonymous(), deterministicId())));
  });
});

/* ────────────────────────────────────────────
 * CREATE
 * ──────────────────────────────────────────── */

describe("clips — create", () => {
  it("a game participant (player1) can create a clip", async () => {
    await assertSucceeds(setDoc(clipRef(asP1(), deterministicId()), makeValidClip()));
  });

  it("a game participant (player2) can create a clip", async () => {
    await assertSucceeds(
      setDoc(clipRef(asP2(), deterministicId(GAME_ID, TURN_NUMBER, "match")), makeValidClip({ role: "match" })),
    );
  });

  it("the nominated judge can create a clip", async () => {
    await seedGame({ judgeId: JUDGE_UID, judgeStatus: "accepted", judgeUsername: "judge" });
    await assertSucceeds(setDoc(clipRef(asJudge(), deterministicId()), makeValidClip()));
  });

  it("a stranger who isn't in the game CANNOT create a clip", async () => {
    await assertFails(setDoc(clipRef(asStranger(), deterministicId()), makeValidClip()));
  });

  it("an anonymous user CANNOT create a clip", async () => {
    await assertFails(setDoc(clipRef(asAnonymous(), deterministicId()), makeValidClip()));
  });

  it("rejects a doc whose id does not match gameId_turnNumber_role", async () => {
    await assertFails(setDoc(clipRef(asP1(), "not-the-right-id"), makeValidClip()));
  });

  it("rejects a role outside the set/match enum", async () => {
    await assertFails(setDoc(clipRef(asP1(), `${GAME_ID}_${TURN_NUMBER}_judge`), makeValidClip({ role: "judge" })));
  });

  it("rejects a playerUid that isn't one of the game's players", async () => {
    await assertFails(setDoc(clipRef(asP1(), deterministicId()), makeValidClip({ playerUid: STRANGER_UID })));
  });

  it("rejects a trickName longer than 100 characters", async () => {
    await assertFails(setDoc(clipRef(asP1(), deterministicId()), makeValidClip({ trickName: "x".repeat(101) })));
  });

  it("rejects an empty trickName", async () => {
    await assertFails(setDoc(clipRef(asP1(), deterministicId()), makeValidClip({ trickName: "" })));
  });

  it("rejects an empty videoUrl", async () => {
    await assertFails(setDoc(clipRef(asP1(), deterministicId()), makeValidClip({ videoUrl: "" })));
  });

  it("rejects a videoUrl longer than 2048 characters", async () => {
    await assertFails(setDoc(clipRef(asP1(), deterministicId()), makeValidClip({ videoUrl: "x".repeat(2049) })));
  });

  it("rejects a non-integer turnNumber", async () => {
    await assertFails(setDoc(clipRef(asP1(), `${GAME_ID}_3.5_set`), makeValidClip({ turnNumber: 3.5 })));
  });

  it("rejects a zero turnNumber", async () => {
    await assertFails(setDoc(clipRef(asP1(), `${GAME_ID}_0_set`), makeValidClip({ turnNumber: 0 })));
  });

  it("rejects a clip that claims a createdAt in the past (must equal request.time)", async () => {
    await assertFails(
      setDoc(clipRef(asP1(), deterministicId()), makeValidClip({ createdAt: new Date(Date.now() - 60_000) })),
    );
  });

  it("accepts a clip with a string spotId within the 64-char budget", async () => {
    await assertSucceeds(setDoc(clipRef(asP1(), deterministicId()), makeValidClip({ spotId: "x".repeat(64) })));
  });

  it("rejects a spotId longer than 64 characters", async () => {
    await assertFails(setDoc(clipRef(asP1(), deterministicId()), makeValidClip({ spotId: "x".repeat(65) })));
  });

  it("rejects a clip that tries to start in 'hidden' moderation state (bypass attempt)", async () => {
    await assertFails(setDoc(clipRef(asP1(), deterministicId()), makeValidClip({ moderationStatus: "hidden" })));
  });

  it("rejects a clip missing the moderationStatus field", async () => {
    const clip = makeValidClip();
    delete (clip as Record<string, unknown>).moderationStatus;
    await assertFails(setDoc(clipRef(asP1(), deterministicId()), clip));
  });

  it("rejects a clip whose initial upvoteCount is non-zero (counter-prefill bypass attempt)", async () => {
    await assertFails(setDoc(clipRef(asP1(), deterministicId()), makeValidClip({ upvoteCount: 99 })));
  });

  it("rejects a clip missing the upvoteCount field — required for orderBy('upvoteCount') inclusion", async () => {
    const clip = makeValidClip();
    delete (clip as Record<string, unknown>).upvoteCount;
    await assertFails(setDoc(clipRef(asP1(), deterministicId()), clip));
  });
});

/* ────────────────────────────────────────────
 * UPDATE — content/moderation immutable, only the upvote +1 path is open
 * ──────────────────────────────────────────── */

describe("clips — update forbidden (content + moderation)", () => {
  it("even the original writer CANNOT update a clip's trick name", async () => {
    const id = await seedClip();
    await assertFails(setDoc(clipRef(asP1(), id), makeValidClip({ trickName: "revised" })));
  });

  it("strangers CANNOT update a clip", async () => {
    const id = await seedClip();
    await assertFails(setDoc(clipRef(asStranger(), id), makeValidClip({ trickName: "hacked" })));
  });

  it("the clip owner CANNOT flip moderationStatus themselves (takedown path is Admin SDK only)", async () => {
    const id = await seedClip();
    await assertFails(setDoc(clipRef(asP1(), id), makeValidClip({ moderationStatus: "hidden" })));
  });

  it("nobody can update a field other than upvoteCount, even with a vote in place", async () => {
    const id = await seedClip();
    // Even with the vote precondition met, the affectedKeys clause restricts
    // the diff to {upvoteCount} only — a content edit is still rejected.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "clipVotes", `${P2_UID}_${id}`), {
        uid: P2_UID,
        clipId: id,
        createdAt: serverTimestamp(),
      });
    });
    // Note: P2 already has a vote, so the !exists clause would also fail —
    // but the affectedKeys check is the first-line guarantee of immutability.
    await assertFails(updateDoc(clipRef(asP2(), id), { trickName: "rewrite" }));
  });
});

describe("clips — upvoteCount narrow update path", () => {
  it("a verified voter CAN bump upvoteCount by 1 when their clipVote is created in the same transaction", async () => {
    const id = await seedClip();
    // Mirrors the production path in services/clips.ts#upvoteClip: vote
    // create + upvoteCount += 1 in one transaction, gated by the rule's
    // !exists() pre-check and existsAfter() post-check.
    await assertSucceeds(
      runTransaction(asP2().firestore(), async (tx) => {
        tx.set(doc(asP2().firestore(), "clipVotes", `${P2_UID}_${id}`), {
          uid: P2_UID,
          clipId: id,
          createdAt: serverTimestamp(),
        });
        tx.update(doc(asP2().firestore(), "clips", id), { upvoteCount: 1 });
      }),
    );
  });

  it("rejects a naked upvoteCount bump that isn't paired with a clipVote create", async () => {
    // Without the vote write, existsAfter() fails — the counter cannot move
    // unless an accompanying rule-validated vote doc exists post-tx.
    const id = await seedClip();
    await assertFails(updateDoc(clipRef(asP2(), id), { upvoteCount: 1 }));
  });

  it("rejects an upvoteCount bump from a user who already has a clipVote (no double-bump on retry)", async () => {
    const id = await seedClip();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "clipVotes", `${P2_UID}_${id}`), {
        uid: P2_UID,
        clipId: id,
        createdAt: serverTimestamp(),
      });
      await setDoc(doc(ctx.firestore(), "clips", id), { ...makeValidClip(), upvoteCount: 1 });
    });
    // Even bundled with another clipVote create attempt, the create would
    // fail (allow update: if false on clipVotes), so we test the standalone
    // update — !exists() returns false since the vote already exists.
    await assertFails(updateDoc(clipRef(asP2(), id), { upvoteCount: 2 }));
  });

  it("rejects bumps larger than +1 (rate-limit on counter inflation)", async () => {
    const id = await seedClip();
    const batch = writeBatch(asP2().firestore());
    batch.set(doc(asP2().firestore(), "clipVotes", `${P2_UID}_${id}`), {
      uid: P2_UID,
      clipId: id,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(asP2().firestore(), "clips", id), { upvoteCount: 5 });
    await assertFails(batch.commit());
  });

  it("rejects bumps that decrement (no implicit downvote path)", async () => {
    const id = await seedClip({ upvoteCount: 3 });
    const batch = writeBatch(asP2().firestore());
    batch.set(doc(asP2().firestore(), "clipVotes", `${P2_UID}_${id}`), {
      uid: P2_UID,
      clipId: id,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(asP2().firestore(), "clips", id), { upvoteCount: 2 });
    await assertFails(batch.commit());
  });

  it("rejects an unverified-email user from bumping upvoteCount (mirrors clipVote create gate)", async () => {
    const id = await seedClip();
    const unverified = testEnv.authenticatedContext("throwaway", { email_verified: false });
    await assertFails(
      runTransaction(unverified.firestore(), async (tx) => {
        tx.set(doc(unverified.firestore(), "clipVotes", `throwaway_${id}`), {
          uid: "throwaway",
          clipId: id,
          createdAt: serverTimestamp(),
        });
        tx.update(doc(unverified.firestore(), "clips", id), { upvoteCount: 1 });
      }),
    );
  });
});

/* ────────────────────────────────────────────
 * DELETE (owner-only, backs account-deletion cascade)
 * ──────────────────────────────────────────── */

describe("clips — delete (owner-only)", () => {
  it("the owning player CAN delete their own clip (GDPR/CCPA cascade)", async () => {
    const id = await seedClip();
    await assertSucceeds(deleteDoc(clipRef(asP1(), id)));
  });

  it("the opponent CANNOT delete someone else's clip", async () => {
    const id = await seedClip();
    await assertFails(deleteDoc(clipRef(asP2(), id)));
  });

  it("the nominated judge CANNOT delete a clip they didn't author", async () => {
    await seedGame({ judgeId: JUDGE_UID, judgeStatus: "accepted", judgeUsername: "judge" });
    const id = await seedClip();
    await assertFails(deleteDoc(clipRef(asJudge(), id)));
  });

  it("strangers CANNOT delete clips", async () => {
    const id = await seedClip();
    await assertFails(deleteDoc(clipRef(asStranger(), id)));
  });

  it("anonymous users CANNOT delete clips", async () => {
    const id = await seedClip();
    await assertFails(deleteDoc(clipRef(asAnonymous(), id)));
  });
});
