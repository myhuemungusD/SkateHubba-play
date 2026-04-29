/**
 * clipVotes — red-team tests for the email_verified requirement added in
 * the April 2026 hardening pass, plus the existing single-vote invariant.
 *
 * Without the verification gate, throwaway accounts could inflate vote
 * counts on the public clips feed. With it, only an email-verified
 * account can cast a vote — matching every other content-producing rule
 * in the codebase (games, spots, comments).
 *
 * The double-vote regression guard asserts the deterministic
 * ${uid}_${clipId} doc id prevents a single user from voting twice on
 * the same clip even if they retry the write.
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
import { doc, setDoc, serverTimestamp, setLogLevel } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-clipvotes-redteam";

const P1_UID = "p1-alice";
const P2_UID = "p2-bob";
const GAME_ID = "game-with-clip";
const TURN_NUMBER = 3;
const CLIP_ID = `${GAME_ID}_${TURN_NUMBER}_set`;

let testEnv: RulesTestEnvironment;

function voteRef(ctx: RulesTestContext, voterUid: string) {
  return doc(ctx.firestore(), "clipVotes", `${voterUid}_${CLIP_ID}`);
}

function makeValidVote(voterUid: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: voterUid,
    clipId: CLIP_ID,
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedClipAndGame(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "games", GAME_ID), {
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
    });
    await setDoc(doc(ctx.firestore(), "clips", CLIP_ID), {
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
  await seedClipAndGame();
});

describe("clipVotes — red-team against email_verified + uniqueness", () => {
  it("attack: unverified-email user CANNOT cast a clipVote", async () => {
    // email_verified: false — this is the exact attack the hardening
    // closes. Previously a throwaway account could inflate counts.
    const unverified = testEnv.authenticatedContext("throwaway-uid", { email_verified: false });
    await assertFails(setDoc(voteRef(unverified, "throwaway-uid"), makeValidVote("throwaway-uid")));
  });

  it("legitimate: verified-email user CAN cast one clipVote", async () => {
    const verified = testEnv.authenticatedContext("voter-uid", { email_verified: true });
    await assertSucceeds(setDoc(voteRef(verified, "voter-uid"), makeValidVote("voter-uid")));
  });

  it("attack: verified user CANNOT double-vote on the same clip (rewrite rejected by update:false)", async () => {
    // First vote seeded via rules-disabled to isolate the second write.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "clipVotes", `voter-uid_${CLIP_ID}`), {
        uid: "voter-uid",
        clipId: CLIP_ID,
        createdAt: new Date(Date.now() - 60_000),
      });
    });
    const verified = testEnv.authenticatedContext("voter-uid", { email_verified: true });
    // Second write against the same deterministic id is an update — rules
    // explicitly forbid updates to clipVotes.
    await assertFails(setDoc(voteRef(verified, "voter-uid"), makeValidVote("voter-uid")));
  });
});
