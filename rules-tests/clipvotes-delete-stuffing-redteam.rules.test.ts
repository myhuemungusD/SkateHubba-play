/**
 * clipVotes DELETE — red-team tests for the vote-stuffing hole closed by
 * requiring a delete to carry its own counter correction.
 *
 * The bug: `allow delete` used to be a bare owner-only check. Deleting the
 * vote doc resets the create rule's implicit one-vote-per-(uid, clipId)
 * guard (the deterministic `${uid}_${clipId}` id) while leaving the earlier
 * +1 on clips.upvoteCount / downvoteCount. One account could therefore cycle
 * cast → bare delete → cast → … and add +1 to the same clip every lap.
 *
 * The fix mirrors the disputeVotes delete rule: owner-only AND (orphaned
 * clip | counter already at its zero floor | the SAME atomic write
 * decrements the counter this vote incremented).
 *
 * Run via:  npm run test:rules
 */
import { describe, it, expect } from "vitest";
import { assertSucceeds, assertFails, type RulesTestContext } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, runTransaction, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { makeClip, setupRulesTestEnv } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-clipvotes-delete-stuffing";

const OWNER_UID = "clip-owner";
const VOTER_UID = "voter-uid";
const STRANGER_UID = "stranger-uid";
const CLIP_ID = "game-with-clip_3_set";
const VOTE_ID = `${VOTER_UID}_${CLIP_ID}`;

const getEnv = setupRulesTestEnv(PROJECT_ID);

/** Seed the clip under test with explicit aggregate values. */
async function seedClip(counts: { upvoteCount?: number; downvoteCount?: number } = {}): Promise<void> {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), "clips", CLIP_ID),
      makeClip({
        playerUid: OWNER_UID,
        upvoteCount: counts.upvoteCount ?? 0,
        downvoteCount: counts.downvoteCount ?? 0,
      }),
    );
  });
}

/**
 * Seed the voter's vote doc. `value: undefined` writes a LEGACY doc with no
 * `value` field at all — those pre-date downvoting and were all upvotes, so
 * the rule reads them as +1.
 */
async function seedVote(value?: 1 | -1, overrides: Record<string, unknown> = {}): Promise<void> {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "clipVotes", VOTE_ID), {
      uid: VOTER_UID,
      clipId: CLIP_ID,
      ...(value === undefined ? {} : { value }),
      createdAt: new Date(Date.now() - 60_000),
      ...overrides,
    });
  });
}

function voter(): RulesTestContext {
  return getEnv().authenticatedContext(VOTER_UID, { email_verified: true });
}

function voteDoc(ctx: RulesTestContext) {
  return doc(ctx.firestore(), "clipVotes", VOTE_ID);
}

function clipDoc(ctx: RulesTestContext) {
  return doc(ctx.firestore(), "clips", CLIP_ID);
}

/** delete(vote) + set(clip counter) as ONE atomic write, the real client shape. */
function pairedDelete(ctx: RulesTestContext, counters: Record<string, number>) {
  const batch = writeBatch(ctx.firestore());
  batch.delete(voteDoc(ctx));
  batch.update(clipDoc(ctx), counters);
  return batch.commit();
}

describe("clipVotes delete — red-team against vote stuffing", () => {
  it("attack: BARE delete while upvoteCount is positive is DENIED", async () => {
    // The stuffing primitive. Dropping the vote doc on its own would free the
    // voter to re-cast (deterministic id no longer taken) while the +1 they
    // already banked stays on the clip.
    await seedClip({ upvoteCount: 1 });
    await seedVote(1);
    await assertFails(deleteDoc(voteDoc(voter())));
  });

  it("attack: BARE delete while downvoteCount is positive is DENIED", async () => {
    await seedClip({ downvoteCount: 1 });
    await seedVote(-1);
    await assertFails(deleteDoc(voteDoc(voter())));
  });

  it("legitimate: delete paired with the matching -1 in one batch is ALLOWED", async () => {
    await seedClip({ upvoteCount: 3, downvoteCount: 2 });
    await seedVote(1);
    await assertSucceeds(pairedDelete(voter(), { upvoteCount: 2 }));
  });

  it("legitimate: downvote withdrawal paired with downvoteCount-1 is ALLOWED", async () => {
    await seedClip({ upvoteCount: 3, downvoteCount: 2 });
    await seedVote(-1);
    await assertSucceeds(pairedDelete(voter(), { downvoteCount: 1 }));
  });

  it("attack: delete paired with a decrement of the WRONG counter is DENIED", async () => {
    // An upvote may only ever pull upvoteCount down. Deflating downvoteCount
    // instead would let a voter both keep their +1 and erase someone else's -1.
    await seedClip({ upvoteCount: 3, downvoteCount: 2 });
    await seedVote(1);
    await assertFails(pairedDelete(voter(), { downvoteCount: 1 }));
  });

  it("attack: delete paired with an INCREMENT of its own counter is DENIED", async () => {
    await seedClip({ upvoteCount: 3 });
    await seedVote(1);
    await assertFails(pairedDelete(voter(), { upvoteCount: 4 }));
  });

  it("attack: delete paired with an oversized decrement (-2) is DENIED", async () => {
    await seedClip({ upvoteCount: 3 });
    await seedVote(1);
    await assertFails(pairedDelete(voter(), { upvoteCount: 1 }));
  });

  it("legitimate: BARE delete is ALLOWED when the clip doc is gone (orphan)", async () => {
    // Account-deletion cascade case: clips.cascade.ts drops the vote bare when
    // the clip no longer exists — there is no aggregate left to keep honest.
    await seedVote(1);
    await assertSucceeds(deleteDoc(voteDoc(voter())));
  });

  it("legitimate: BARE delete is ALLOWED when the fed counter is already 0", async () => {
    // Drifted aggregate / pre-backfill clip. Decrementing would write -1 and
    // hit the clips rule's >= 0 floor, stranding the vote doc forever.
    await seedClip({ upvoteCount: 0, downvoteCount: 5 });
    await seedVote(1);
    await assertSucceeds(deleteDoc(voteDoc(voter())));
  });

  it("legitimate: BARE delete of a downvote is ALLOWED when downvoteCount is 0", async () => {
    await seedClip({ upvoteCount: 5, downvoteCount: 0 });
    await seedVote(-1);
    await assertSucceeds(deleteDoc(voteDoc(voter())));
  });

  it("legitimate: BARE delete is ALLOWED on a legacy clip with no aggregates at all", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      const legacy = makeClip({ playerUid: OWNER_UID });
      delete legacy.upvoteCount;
      delete legacy.downvoteCount;
      await setDoc(doc(ctx.firestore(), "clips", CLIP_ID), legacy);
    });
    await seedVote(1);
    await assertSucceeds(deleteDoc(voteDoc(voter())));
  });

  it("legacy vote (no `value` field) is read as an UPVOTE: bare delete DENIED, paired upvote -1 ALLOWED", async () => {
    await seedClip({ upvoteCount: 2, downvoteCount: 2 });
    await seedVote(undefined);
    await assertFails(deleteDoc(voteDoc(voter())));
    // Same legacy doc, now with the correct correction attached.
    await assertSucceeds(pairedDelete(voter(), { upvoteCount: 1 }));
  });

  it("attack: legacy vote (no `value`) CANNOT decrement downvoteCount", async () => {
    await seedClip({ upvoteCount: 2, downvoteCount: 2 });
    await seedVote(undefined);
    await assertFails(pairedDelete(voter(), { downvoteCount: 1 }));
  });

  it("attack: a NON-OWNER cannot delete someone else's vote, even paired correctly", async () => {
    await seedClip({ upvoteCount: 1 });
    await seedVote(1);
    const stranger = getEnv().authenticatedContext(STRANGER_UID, { email_verified: true });
    await assertFails(deleteDoc(voteDoc(stranger)));
    await assertFails(pairedDelete(stranger, { upvoteCount: 0 }));
  });

  it("attack: an unauthenticated client cannot delete a vote", async () => {
    await seedClip({ upvoteCount: 1 });
    await seedVote(1);
    await assertFails(deleteDoc(voteDoc(getEnv().unauthenticatedContext())));
  });

  it("legitimate: the vote FLIP (delete + set of the same doc in one tx) still works", async () => {
    // Firestore coalesces both writes on the vote doc into a single UPDATE, so
    // this lands on the flip clause — not on the delete rule. Regression guard:
    // the delete hardening must not break flipping.
    await seedClip({ upvoteCount: 2, downvoteCount: 1 });
    await seedVote(1);
    const ctx = voter();
    await assertSucceeds(
      runTransaction(ctx.firestore(), async (tx) => {
        await tx.get(clipDoc(ctx));
        tx.delete(voteDoc(ctx));
        tx.set(voteDoc(ctx), {
          uid: VOTER_UID,
          clipId: CLIP_ID,
          value: -1,
          createdAt: serverTimestamp(),
        });
        tx.update(clipDoc(ctx), { upvoteCount: 1, downvoteCount: 2 });
      }),
    );
    await getEnv().withSecurityRulesDisabled(async (admin) => {
      const snap = await getDoc(doc(admin.firestore(), "clips", CLIP_ID));
      expect(snap.data()).toMatchObject({ upvoteCount: 1, downvoteCount: 2 });
    });
  });

  it("regression: the full stuffing CYCLE cannot inflate a counter", async () => {
    // cast (+1) → bare delete → cast again. With the hole open this ends at
    // upvoteCount 2 from a single account; with it closed the bare delete is
    // rejected, so the counter can never exceed 1.
    await seedClip({ upvoteCount: 0 });
    const ctx = voter();
    const castBatch = writeBatch(ctx.firestore());
    castBatch.set(voteDoc(ctx), {
      uid: VOTER_UID,
      clipId: CLIP_ID,
      value: 1,
      createdAt: serverTimestamp(),
    });
    castBatch.update(clipDoc(ctx), { upvoteCount: 1 });
    await assertSucceeds(castBatch.commit());

    await assertFails(deleteDoc(voteDoc(ctx)));

    await getEnv().withSecurityRulesDisabled(async (admin) => {
      const snap = await getDoc(doc(admin.firestore(), "clips", CLIP_ID));
      expect(snap.data()?.upvoteCount).toBe(1);
    });
  });
});
