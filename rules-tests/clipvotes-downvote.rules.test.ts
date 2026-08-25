/**
 * clipVotes `value` (+1 / -1) and the two-counter aggregate matrix on /clips.
 *
 * The whole ranking surface rests on one invariant: a counter may only move
 * when the caller's OWN clipVotes/{uid}_{clipId} doc moves with it, in the
 * direction that doc's `value` declares. Three accepted shapes:
 *
 *   cast     — vote absent → present   (one counter +1)
 *   withdraw — vote present → absent   (one counter -1)
 *   flip     — vote deleted + re-created in ONE transaction
 *              (one counter -1 AND the other +1)
 *
 * Everything else — forged deltas, unpaired writes, wrong-counter moves,
 * self-votes in either direction — must be denied.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails, type RulesTestContext } from "@firebase/rules-unit-testing";
import { doc, setDoc, serverTimestamp, runTransaction } from "firebase/firestore";
import { makeClip, setupRulesTestEnv } from "./_fixtures";

const OWNER_UID = "owner-uid";
const VOTER_UID = "voter-uid";
const CLIP_ID = "game-with-clip_3_set";

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-clipvotes-downvote", async (env) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), "clips", CLIP_ID),
      makeClip({ gameId: "game-with-clip", turnNumber: 3, playerUid: OWNER_UID, upvoteCount: 0, downvoteCount: 0 }),
    );
  });
});

function voter(uid = VOTER_UID, emailVerified = true): RulesTestContext {
  return getEnv().authenticatedContext(uid, { email_verified: emailVerified });
}

function clipRef(ctx: RulesTestContext) {
  return doc(ctx.firestore(), "clips", CLIP_ID);
}

function voteRef(ctx: RulesTestContext, uid = VOTER_UID) {
  return doc(ctx.firestore(), "clipVotes", `${uid}_${CLIP_ID}`);
}

function makeVote(uid: string, value: number): Record<string, unknown> {
  return { uid, clipId: CLIP_ID, value, createdAt: serverTimestamp() };
}

/** Seed the clip's stored counters (rules-disabled). */
async function seedCounts(up: number, down: number): Promise<void> {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), "clips", CLIP_ID),
      makeClip({ gameId: "game-with-clip", turnNumber: 3, playerUid: OWNER_UID, upvoteCount: up, downvoteCount: down }),
    );
  });
}

/** Seed an existing vote doc for VOTER_UID with the given direction. */
async function seedVote(value: number, uid = VOTER_UID): Promise<void> {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "clipVotes", `${uid}_${CLIP_ID}`), {
      uid,
      clipId: CLIP_ID,
      value,
      createdAt: new Date(Date.now() - 60_000),
    });
  });
}

/** cast: create the vote doc + apply `clipUpdate` atomically. */
function castAndUpdate(ctx: RulesTestContext, value: number, clipUpdate: Record<string, unknown>): Promise<void> {
  return runTransaction(ctx.firestore(), async (tx) => {
    await tx.get(clipRef(ctx));
    tx.set(voteRef(ctx), makeVote(VOTER_UID, value));
    tx.update(clipRef(ctx), clipUpdate);
  });
}

/** withdraw: delete the vote doc + apply `clipUpdate` atomically. */
function withdrawAndUpdate(ctx: RulesTestContext, clipUpdate: Record<string, unknown>): Promise<void> {
  return runTransaction(ctx.firestore(), async (tx) => {
    await tx.get(clipRef(ctx));
    tx.delete(voteRef(ctx));
    tx.update(clipRef(ctx), clipUpdate);
  });
}

/** flip: delete + re-create the SAME voteId, plus the paired clip update. */
function flipAndUpdate(ctx: RulesTestContext, newValue: number, clipUpdate: Record<string, unknown>): Promise<void> {
  return runTransaction(ctx.firestore(), async (tx) => {
    await tx.get(clipRef(ctx));
    tx.delete(voteRef(ctx));
    tx.set(voteRef(ctx), makeVote(VOTER_UID, newValue));
    tx.update(clipRef(ctx), clipUpdate);
  });
}

describe("clipVotes — value validation", () => {
  it("accepts value: 1 (upvote)", async () => {
    await assertSucceeds(setDoc(voteRef(voter()), makeVote(VOTER_UID, 1)));
  });

  it("accepts value: -1 (downvote)", async () => {
    await assertSucceeds(setDoc(voteRef(voter()), makeVote(VOTER_UID, -1)));
  });

  it("attack: rejects an out-of-range value (weighted vote)", async () => {
    await assertFails(setDoc(voteRef(voter()), makeVote(VOTER_UID, 100)));
  });

  it("attack: rejects value: 0", async () => {
    await assertFails(setDoc(voteRef(voter()), makeVote(VOTER_UID, 0)));
  });

  it("attack: rejects a missing value", async () => {
    await assertFails(setDoc(voteRef(voter()), { uid: VOTER_UID, clipId: CLIP_ID, createdAt: serverTimestamp() }));
  });

  it("attack: rejects a stringified value that would coerce client-side", async () => {
    await assertFails(setDoc(voteRef(voter()), makeVote(VOTER_UID, "1" as unknown as number)));
  });

  it("attack: the clip OWNER cannot self-UPVOTE", async () => {
    await assertFails(setDoc(voteRef(voter(OWNER_UID), OWNER_UID), makeVote(OWNER_UID, 1)));
  });

  it("attack: the clip OWNER cannot self-DOWNVOTE either", async () => {
    await assertFails(setDoc(voteRef(voter(OWNER_UID), OWNER_UID), makeVote(OWNER_UID, -1)));
  });
});

describe("clips — two-counter matrix: cast", () => {
  it("upvote cast moves upvoteCount +1 only", async () => {
    await assertSucceeds(castAndUpdate(voter(), 1, { upvoteCount: 1 }));
  });

  it("downvote cast moves downvoteCount +1 only", async () => {
    await assertSucceeds(castAndUpdate(voter(), -1, { downvoteCount: 1 }));
  });

  it("attack: an upvote doc cannot bump downvoteCount", async () => {
    await assertFails(castAndUpdate(voter(), 1, { downvoteCount: 1 }));
  });

  it("attack: a downvote doc cannot bump upvoteCount", async () => {
    await assertFails(castAndUpdate(voter(), -1, { upvoteCount: 1 }));
  });

  it("attack: a single vote cannot bump BOTH counters", async () => {
    await assertFails(castAndUpdate(voter(), 1, { upvoteCount: 1, downvoteCount: 1 }));
  });

  it("attack: a forged delta (+5) is rejected", async () => {
    await assertFails(castAndUpdate(voter(), -1, { downvoteCount: 5 }));
  });

  it("attack: a counter cannot move with NO paired vote write", async () => {
    const ctx = voter();
    await assertFails(
      runTransaction(ctx.firestore(), async (tx) => {
        await tx.get(clipRef(ctx));
        tx.update(clipRef(ctx), { downvoteCount: 1 });
      }),
    );
  });

  it("attack: an unverified account cannot move a counter", async () => {
    await assertFails(castAndUpdate(voter(VOTER_UID, false), 1, { upvoteCount: 1 }));
  });
});

describe("clips — two-counter matrix: withdraw", () => {
  it("withdrawing an upvote moves upvoteCount -1 only", async () => {
    await seedCounts(1, 0);
    await seedVote(1);
    await assertSucceeds(withdrawAndUpdate(voter(), { upvoteCount: 0 }));
  });

  it("withdrawing a downvote moves downvoteCount -1 only", async () => {
    await seedCounts(0, 1);
    await seedVote(-1);
    await assertSucceeds(withdrawAndUpdate(voter(), { downvoteCount: 0 }));
  });

  it("attack: withdrawing a downvote cannot deflate upvoteCount instead", async () => {
    await seedCounts(3, 1);
    await seedVote(-1);
    await assertFails(withdrawAndUpdate(voter(), { upvoteCount: 2 }));
  });

  it("attack: withdrawing an upvote cannot deflate a rival's downvoteCount", async () => {
    await seedCounts(1, 3);
    await seedVote(1);
    await assertFails(withdrawAndUpdate(voter(), { downvoteCount: 2 }));
  });

  it("attack: neither counter can go below zero", async () => {
    await seedCounts(0, 0);
    await seedVote(-1);
    await assertFails(withdrawAndUpdate(voter(), { downvoteCount: -1 }));
  });
});

describe("clips — two-counter matrix: flip (delete + re-create in one tx)", () => {
  it("up → down moves upvoteCount -1 AND downvoteCount +1", async () => {
    await seedCounts(1, 0);
    await seedVote(1);
    await assertSucceeds(flipAndUpdate(voter(), -1, { upvoteCount: 0, downvoteCount: 1 }));
  });

  it("down → up moves downvoteCount -1 AND upvoteCount +1", async () => {
    await seedCounts(0, 1);
    await seedVote(-1);
    await assertSucceeds(flipAndUpdate(voter(), 1, { upvoteCount: 1, downvoteCount: 0 }));
  });

  it("attack: a flip cannot move both counters in the SAME direction", async () => {
    await seedCounts(1, 0);
    await seedVote(1);
    await assertFails(flipAndUpdate(voter(), -1, { upvoteCount: 2, downvoteCount: 1 }));
  });

  it("attack: a flip cannot move a counter by more than one", async () => {
    await seedCounts(5, 0);
    await seedVote(1);
    await assertFails(flipAndUpdate(voter(), -1, { upvoteCount: 0, downvoteCount: 5 }));
  });

  it("attack: re-casting the SAME direction is not a flip — denied", async () => {
    await seedCounts(1, 0);
    await seedVote(1);
    await assertFails(flipAndUpdate(voter(), 1, { upvoteCount: 2 }));
  });

  it("attack: a flip cannot ride a content edit along", async () => {
    await seedCounts(1, 0);
    await seedVote(1);
    await assertFails(flipAndUpdate(voter(), -1, { upvoteCount: 0, downvoteCount: 1, trickName: "rewritten" }));
  });
});
