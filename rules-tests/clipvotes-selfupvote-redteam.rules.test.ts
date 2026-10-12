/**
 * clipVotes — red-team guard on SERVER-ENFORCED no self-upvote.
 *
 * The clipVotes create rule now reads the target clip's owner and rejects a
 * vote whose caller IS that owner. Previously the only barrier was the
 * service-layer SelfUpvoteError (UX only) — a client hitting the Firestore
 * API directly could upvote its own clip and inflate feed ranking. (audit
 * MEDIUM)
 *
 * Run via:  npm run test:rules
 */
import { describe, it, beforeEach } from "vitest";
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, runTransaction, setDoc, serverTimestamp } from "firebase/firestore";
import { setupRulesTestEnv, makeClip } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-clipvotes-selfupvote-redteam";

const OWNER_UID = "owner-alice"; // the player who landed the clip
const OTHER_UID = "other-bob"; // a bystander who may upvote
const GAME_ID = "game-selfupvote";
const TURN_NUMBER = 3;
const CLIP_ID = `${GAME_ID}_${TURN_NUMBER}_set`;

const getEnv = setupRulesTestEnv(PROJECT_ID);

function makeVote(uid: string): Record<string, unknown> {
  return { uid, clipId: CLIP_ID, value: 1, createdAt: serverTimestamp() };
}

/** A real cast: the vote doc and the matching +1 land in one write. */
function castUpvote(uid: string): Promise<void> {
  const ctx = getEnv().authenticatedContext(uid, { email_verified: true });
  const db = ctx.firestore();
  const clip = doc(db, "clips", CLIP_ID);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(clip);
    const current = snap.data()?.upvoteCount;
    const upvoteCount = typeof current === "number" ? current + 1 : 1;
    tx.set(doc(db, "clipVotes", `${uid}_${CLIP_ID}`), makeVote(uid));
    tx.update(clip, { upvoteCount });
  });
}

beforeEach(async () => {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "games", GAME_ID), {
      player1Uid: OWNER_UID,
      player2Uid: OTHER_UID,
      player1Username: "alice",
      player2Username: "bob",
      status: "active",
    });
    await setDoc(
      doc(ctx.firestore(), "clips", CLIP_ID),
      makeClip({
        gameId: GAME_ID,
        turnNumber: TURN_NUMBER,
        playerUid: OWNER_UID, // clip is owned by OWNER
      }),
    );
  });
});

describe("clipVotes — red-team against self-upvote", () => {
  it("attack: the clip's OWNER cannot create a clipVotes doc for their own clip", async () => {
    await assertFails(castUpvote(OWNER_UID));
  });

  it("legitimate: a NON-owner can upvote the clip", async () => {
    await assertSucceeds(castUpvote(OTHER_UID));
  });
});
