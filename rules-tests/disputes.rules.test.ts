/**
 * Firestore rules tests for the community-judging feature: `disputes` and
 * `disputeVotes`.
 *
 * A dispute is raised by the SETTER when they don't want to take the
 * matcher's "I landed it" on the honor system. The clip enters the feed and
 * any OTHER signed-in user rules LAND or BAIL.
 *
 * The rules must:
 *   • allow any signed-in user to read (feed is app-wide, like clips)
 *   • let ONLY the setter of the disputed turn create the dispute
 *   • enforce a deterministic `${gameId}_${turnNumber}` doc id
 *   • bucket-pin matchVideoUrl (rendered verbatim in a public feed)
 *   • seed tallies at 0 / status 'open' / moderationStatus 'active'
 *   • permit exactly ONE tally field to move, by exactly +1, and only when
 *     paired with the matching disputeVotes create in the same write
 *   • refuse verdicts from either player in the disputed game
 *   • refuse a second verdict from the same user (no un-vote, no re-vote)
 *
 * Run via:  npm run test:rules
 */
import { describe, it, expect } from "vitest";
import { assertSucceeds, assertFails, type RulesTestContext } from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
} from "firebase/firestore";
import { setupRulesTestEnv, seedValidGame, authedContext } from "./_fixtures";

const P1_UID = "p1-alice"; // setter — the one who raises the dispute
const P2_UID = "p2-bob"; // matcher — the one whose claim is judged
const JUDGE_UID = "j-judge";
const VIEWER_UID = "v-viewer"; // uninvolved third party — the only valid voter
const OTHER_VIEWER_UID = "v-viewer-2";

const GAME_ID = "game1";
const TURN_NUMBER = 4;
const DISPUTE_ID = `${GAME_ID}_${TURN_NUMBER}`;

// Bucket-pinned per the audit-P2 host pin. Anything else must be rejected.
const PINNED_URL = "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/match.webm";
const PINNED_SET_URL = "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/set.webm";

// Gap A closure (binding-dispute Phase 2): the /disputes create rule now binds
// the disputer to the REAL frozen turn — the backing game must be parked in
// `pendingReview` with currentSetter == the raiser (P1) and turnNumber ==
// TURN_NUMBER, or every legitimate raise is (correctly) denied. Seed that
// frozen state so the create-path positives exercise only the field under test.
const getEnv = setupRulesTestEnv("demo-skatehubba-rules-disputes", async (env) => {
  await seedValidGame(
    env,
    GAME_ID,
    { player1Uid: P1_UID, player2Uid: P2_UID },
    {
      phase: "pendingReview",
      currentSetter: P1_UID,
      currentTurn: P2_UID,
      turnNumber: TURN_NUMBER,
      reviewFor: P2_UID,
      reviewDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  );
});

function makeValidDispute(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gameId: GAME_ID,
    turnNumber: TURN_NUMBER,
    trickName: "tre flip",
    setterUid: P1_UID,
    setterUsername: "alice",
    matcherUid: P2_UID,
    matcherUsername: "bob",
    setVideoUrl: PINNED_SET_URL,
    matchVideoUrl: PINNED_URL,
    spotId: null,
    createdAt: serverTimestamp(),
    status: "open",
    moderationStatus: "active",
    landVotes: 0,
    bailVotes: 0,
    ...overrides,
  };
}

function makeValidVote(voterUid: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: voterUid,
    disputeId: DISPUTE_ID,
    verdict: "land",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

function as(uid: string, emailVerified = true): RulesTestContext {
  return emailVerified ? authedContext(getEnv(), uid) : getEnv().authenticatedContext(uid, { email_verified: false });
}

function anon(): RulesTestContext {
  return getEnv().unauthenticatedContext();
}

function disputeRef(ctx: RulesTestContext, id: string = DISPUTE_ID): DocumentReference {
  return doc(ctx.firestore(), "disputes", id);
}

function voteRef(ctx: RulesTestContext, voterUid: string, disputeId: string = DISPUTE_ID): DocumentReference {
  return doc(ctx.firestore(), "disputeVotes", `${voterUid}_${disputeId}`);
}

async function seedDispute(overrides: Record<string, unknown> = {}): Promise<void> {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "disputes", DISPUTE_ID), makeValidDispute(overrides));
  });
}

/** Seed a verdict already cast by `voterUid`, with the tally to match. */
async function seedExistingVote(voterUid: string, verdict: "land" | "bail" = "land"): Promise<void> {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "disputeVotes", `${voterUid}_${DISPUTE_ID}`), {
      uid: voterUid,
      disputeId: DISPUTE_ID,
      verdict,
      createdAt: new Date(Date.now() - 60_000),
    });
  });
}

/**
 * The real client write shape: create the vote doc and bump the matching
 * tally in ONE atomic commit. `disputeUpdate` is passed through verbatim so
 * red-team cases can send an arbitrary delta / extra field.
 */
function voteAndTally(
  ctx: RulesTestContext,
  voterUid: string,
  vote: Record<string, unknown>,
  disputeUpdate: Record<string, unknown>,
): Promise<void> {
  return runTransaction(ctx.firestore(), async (tx) => {
    await tx.get(disputeRef(ctx));
    tx.set(voteRef(ctx, voterUid), vote);
    tx.update(disputeRef(ctx), disputeUpdate);
  });
}

/**
 * The erasure/retract shape: delete the vote doc and apply the paired tally
 * correction in ONE commit — what `deleteUserDisputeVotes` issues.
 */
function retractVote(ctx: RulesTestContext, voterUid: string, disputeUpdate: Record<string, unknown>): Promise<void> {
  return runTransaction(ctx.firestore(), async (tx) => {
    await tx.get(disputeRef(ctx));
    tx.delete(voteRef(ctx, voterUid));
    tx.update(disputeRef(ctx), disputeUpdate);
  });
}

/** Read a tally straight off the doc, bypassing rules. */
async function readTally(field: "landVotes" | "bailVotes"): Promise<unknown> {
  let value: unknown;
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), "disputes", DISPUTE_ID));
    value = snap.data()?.[field];
  });
  return value;
}

/* ────────────────────────────────────────────
 * READ
 * ──────────────────────────────────────────── */

describe("disputes — read", () => {
  it("any signed-in user CAN read a dispute (feed is app-wide)", async () => {
    await seedDispute();
    await assertSucceeds(getDoc(disputeRef(as(VIEWER_UID))));
  });

  it("anonymous users CANNOT read disputes", async () => {
    await seedDispute();
    await assertFails(getDoc(disputeRef(anon())));
  });
});

/* ────────────────────────────────────────────
 * CREATE
 * ──────────────────────────────────────────── */

describe("disputes — create", () => {
  it("the SETTER of the disputed turn CAN raise the dispute", async () => {
    await assertSucceeds(setDoc(disputeRef(as(P1_UID)), makeValidDispute()));
  });

  it("the setter CAN raise a dispute with a null setVideoUrl (old turns lack one)", async () => {
    await assertSucceeds(setDoc(disputeRef(as(P1_UID)), makeValidDispute({ setVideoUrl: null })));
  });

  it("the MATCHER CANNOT raise the dispute (only the setter disputes the claim)", async () => {
    await assertFails(setDoc(disputeRef(as(P2_UID)), makeValidDispute()));
  });

  // ── Gap A (role self-assertion) — CLOSED (binding-dispute Phase 2) ──
  // The freeze parks the game in `pendingReview` with currentSetter/turnNumber
  // still naming the disputed turn, so the create rule now binds
  // setterUid == game.currentSetter && turnNumber == game.turnNumber &&
  // game.phase == 'pendingReview'. The matcher (P2) inverting the roles to name
  // THEMSELVES setter no longer works: P2 != game.currentSetter (P1).
  it("Gap A CLOSED: the matcher CANNOT flip the roles to name themselves setter", async () => {
    await assertFails(setDoc(disputeRef(as(P2_UID)), makeValidDispute({ setterUid: P2_UID, matcherUid: P1_UID })));
  });

  it("Gap A: the REAL frozen setter (currentSetter of a pendingReview game) CAN raise", async () => {
    // The positive control for the binding: same P1 setter, correct turn, game
    // frozen — this is the one identity the rule now trusts.
    await assertSucceeds(setDoc(disputeRef(as(P1_UID)), makeValidDispute()));
  });

  it("Gap A: a dispute naming the WRONG turnNumber is DENIED even from the real setter", async () => {
    // Game is frozen on TURN_NUMBER (4); a dispute over turn 5 (id + payload)
    // fails the turnNumber == game.turnNumber bind.
    await assertFails(setDoc(disputeRef(as(P1_UID), `${GAME_ID}_5`), makeValidDispute({ turnNumber: 5 })));
  });

  it("Gap A: a dispute against a game NOT in pendingReview is DENIED", async () => {
    // Re-seed the backing game back to normal setting play (unfrozen). The
    // real setter's raise must now be rejected — there is no frozen turn to
    // bind against.
    await seedValidGame(
      getEnv(),
      GAME_ID,
      { player1Uid: P1_UID, player2Uid: P2_UID },
      { phase: "setting", currentSetter: P1_UID, turnNumber: TURN_NUMBER },
    );
    await assertFails(setDoc(disputeRef(as(P1_UID)), makeValidDispute()));
  });

  it("a non-participant stranger CANNOT raise a dispute", async () => {
    await assertFails(setDoc(disputeRef(as(VIEWER_UID)), makeValidDispute({ setterUid: VIEWER_UID })));
  });

  it("the nominated judge CANNOT raise a dispute (participant, but not the setter)", async () => {
    await seedValidGame(
      getEnv(),
      GAME_ID,
      { player1Uid: P1_UID, player2Uid: P2_UID },
      { judgeId: JUDGE_UID, judgeStatus: "accepted", judgeUsername: "judge" },
    );
    await assertFails(setDoc(disputeRef(as(JUDGE_UID)), makeValidDispute({ setterUid: JUDGE_UID })));
  });

  it("an unverified-email setter CANNOT raise a dispute", async () => {
    await assertFails(setDoc(disputeRef(as(P1_UID, false)), makeValidDispute()));
  });

  it("an anonymous user CANNOT raise a dispute", async () => {
    await assertFails(setDoc(disputeRef(anon()), makeValidDispute()));
  });

  it("rejects a doc id that isn't gameId_turnNumber", async () => {
    await assertFails(setDoc(disputeRef(as(P1_UID), "not-the-right-id"), makeValidDispute()));
  });

  it("rejects a doc id built from a DIFFERENT turn than the payload claims", async () => {
    await assertFails(setDoc(disputeRef(as(P1_UID), `${GAME_ID}_99`), makeValidDispute()));
  });

  it("rejects a setterUid that isn't the caller", async () => {
    await assertFails(setDoc(disputeRef(as(P1_UID)), makeValidDispute({ setterUid: P2_UID })));
  });

  it("rejects a matcherUid that isn't a player in the game", async () => {
    await assertFails(setDoc(disputeRef(as(P1_UID)), makeValidDispute({ matcherUid: VIEWER_UID })));
  });

  it("rejects a dispute where setter and matcher are the same user", async () => {
    await assertFails(setDoc(disputeRef(as(P1_UID)), makeValidDispute({ matcherUid: P1_UID })));
  });

  it("rejects a dispute against a game that does not exist", async () => {
    await assertFails(
      setDoc(disputeRef(as(P1_UID), `ghost-game_${TURN_NUMBER}`), makeValidDispute({ gameId: "ghost-game" })),
    );
  });

  // ── matchVideoUrl bucket pin (audit P2 parity with clips.videoUrl) ──
  it("rejects a matchVideoUrl pointing at an arbitrary attacker host", async () => {
    await assertFails(
      setDoc(disputeRef(as(P1_UID)), makeValidDispute({ matchVideoUrl: "https://attacker.com/payload.html" })),
    );
  });

  it("rejects a matchVideoUrl pointing at ANOTHER project's Storage bucket", async () => {
    await assertFails(
      setDoc(
        disputeRef(as(P1_UID)),
        makeValidDispute({
          matchVideoUrl: "https://firebasestorage.googleapis.com/v0/b/attacker-project.firebasestorage.app/o/x.webm",
        }),
      ),
    );
  });

  it("rejects a dot-wildcard bypass bucket on matchVideoUrl", async () => {
    await assertFails(
      setDoc(
        disputeRef(as(P1_UID)),
        makeValidDispute({
          matchVideoUrl: "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806xfirebasestoragexapp/o/x.webm",
        }),
      ),
    );
  });

  it("rejects http:// even on the project bucket host", async () => {
    await assertFails(
      setDoc(
        disputeRef(as(P1_UID)),
        makeValidDispute({
          matchVideoUrl: "http://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/x.webm",
        }),
      ),
    );
  });

  it("permits the bucket-as-host CDN form on matchVideoUrl (mirrors the games/clips rule)", async () => {
    await assertSucceeds(
      setDoc(
        disputeRef(as(P1_UID)),
        makeValidDispute({ matchVideoUrl: "https://sk8hub-d7806.firebasestorage.app/o/match.webm" }),
      ),
    );
  });

  it("rejects a null matchVideoUrl — the judged clip is required", async () => {
    await assertFails(setDoc(disputeRef(as(P1_UID)), makeValidDispute({ matchVideoUrl: null })));
  });

  it("rejects an off-bucket setVideoUrl when one is supplied", async () => {
    await assertFails(
      setDoc(disputeRef(as(P1_UID)), makeValidDispute({ setVideoUrl: "https://attacker.com/set.webm" })),
    );
  });

  it("rejects a landVotes tally that doesn't seed at 0", async () => {
    await assertFails(setDoc(disputeRef(as(P1_UID)), makeValidDispute({ landVotes: 7 })));
  });

  it("rejects a bailVotes tally that doesn't seed at 0", async () => {
    await assertFails(setDoc(disputeRef(as(P1_UID)), makeValidDispute({ bailVotes: 7 })));
  });

  it("rejects a dispute missing the tally fields entirely", async () => {
    const payload = makeValidDispute();
    delete payload.landVotes;
    delete payload.bailVotes;
    await assertFails(setDoc(disputeRef(as(P1_UID)), payload));
  });

  it("rejects a dispute that starts already 'closed'", async () => {
    await assertFails(setDoc(disputeRef(as(P1_UID)), makeValidDispute({ status: "closed" })));
  });

  it("rejects a dispute that starts in 'hidden' moderation state (takedown bypass)", async () => {
    await assertFails(setDoc(disputeRef(as(P1_UID)), makeValidDispute({ moderationStatus: "hidden" })));
  });

  it("rejects a back-dated createdAt (must equal request.time)", async () => {
    await assertFails(setDoc(disputeRef(as(P1_UID)), makeValidDispute({ createdAt: new Date(Date.now() - 60_000) })));
  });

  it("rejects an empty trickName", async () => {
    await assertFails(setDoc(disputeRef(as(P1_UID)), makeValidDispute({ trickName: "" })));
  });

  it("rejects a trickName longer than 100 characters", async () => {
    await assertFails(setDoc(disputeRef(as(P1_UID)), makeValidDispute({ trickName: "x".repeat(101) })));
  });

  it("rejects a username longer than 20 characters", async () => {
    await assertFails(setDoc(disputeRef(as(P1_UID)), makeValidDispute({ matcherUsername: "x".repeat(21) })));
  });

  it("rejects a zero turnNumber", async () => {
    await assertFails(setDoc(disputeRef(as(P1_UID), `${GAME_ID}_0`), makeValidDispute({ turnNumber: 0 })));
  });

  it("rejects a spotId longer than 64 characters", async () => {
    await assertFails(setDoc(disputeRef(as(P1_UID)), makeValidDispute({ spotId: "x".repeat(65) })));
  });

  it("accepts a spotId within the 64-char budget", async () => {
    await assertSucceeds(setDoc(disputeRef(as(P1_UID)), makeValidDispute({ spotId: "x".repeat(64) })));
  });
});

/* ────────────────────────────────────────────
 * UPDATE — tally increment paired with a verdict
 * ──────────────────────────────────────────── */

describe("disputes — tally increment (paired vote-doc create only)", () => {
  it("an uninvolved viewer CAN cast a LAND verdict and bump landVotes by +1", async () => {
    await seedDispute();
    await assertSucceeds(voteAndTally(as(VIEWER_UID), VIEWER_UID, makeValidVote(VIEWER_UID), { landVotes: 1 }));
    expect(await readTally("landVotes")).toBe(1);
  });

  it("an uninvolved viewer CAN cast a BAIL verdict and bump bailVotes by +1", async () => {
    await seedDispute();
    await assertSucceeds(
      voteAndTally(as(VIEWER_UID), VIEWER_UID, makeValidVote(VIEWER_UID, { verdict: "bail" }), { bailVotes: 1 }),
    );
  });

  it("a second viewer CAN add to a tally that already has votes", async () => {
    await seedDispute({ landVotes: 3, bailVotes: 1 });
    await assertSucceeds(
      voteAndTally(as(OTHER_VIEWER_UID), OTHER_VIEWER_UID, makeValidVote(OTHER_VIEWER_UID), { landVotes: 4 }),
    );
  });

  it("the SAME user CANNOT vote twice (verdicts are final — no re-vote, no un-vote)", async () => {
    await seedDispute({ landVotes: 1 });
    await seedExistingVote(VIEWER_UID);
    await assertFails(voteAndTally(as(VIEWER_UID), VIEWER_UID, makeValidVote(VIEWER_UID), { landVotes: 2 }));
  });

  it("the SAME user CANNOT re-vote after retracting (delete → re-vote nets zero, not +2)", async () => {
    // The stuffing cycle, run end to end: +1, retract (-1), vote again (+1).
    // The tally must land back on exactly 1, never 2.
    await seedDispute();
    await assertSucceeds(voteAndTally(as(VIEWER_UID), VIEWER_UID, makeValidVote(VIEWER_UID), { landVotes: 1 }));
    await assertSucceeds(retractVote(as(VIEWER_UID), VIEWER_UID, { landVotes: 0 }));
    await assertSucceeds(voteAndTally(as(VIEWER_UID), VIEWER_UID, makeValidVote(VIEWER_UID), { landVotes: 1 }));
    expect(await readTally("landVotes")).toBe(1);
  });

  it("the SETTER CANNOT vote on their own dispute", async () => {
    await seedDispute();
    await assertFails(voteAndTally(as(P1_UID), P1_UID, makeValidVote(P1_UID), { landVotes: 1 }));
  });

  it("the MATCHER CANNOT vote on the dispute over their own claim", async () => {
    await seedDispute();
    await assertFails(voteAndTally(as(P2_UID), P2_UID, makeValidVote(P2_UID, { verdict: "land" }), { landVotes: 1 }));
  });

  it("nobody can vote on a CLOSED dispute", async () => {
    await seedDispute({ status: "closed" });
    await assertFails(voteAndTally(as(VIEWER_UID), VIEWER_UID, makeValidVote(VIEWER_UID), { landVotes: 1 }));
  });

  it("a user CANNOT bump a tally without the paired vote-doc create", async () => {
    await seedDispute();
    await assertFails(updateDoc(disputeRef(as(VIEWER_UID)), { landVotes: 1 }));
  });

  it("a user CANNOT bump a tally by more than +1", async () => {
    await seedDispute();
    await assertFails(voteAndTally(as(VIEWER_UID), VIEWER_UID, makeValidVote(VIEWER_UID), { landVotes: 25 }));
  });

  it("a user CANNOT move BOTH tallies in one write", async () => {
    await seedDispute();
    await assertFails(
      voteAndTally(as(VIEWER_UID), VIEWER_UID, makeValidVote(VIEWER_UID), { landVotes: 1, bailVotes: 1 }),
    );
  });

  it("a user CANNOT bump a tally alongside another field", async () => {
    await seedDispute();
    await assertFails(
      voteAndTally(as(VIEWER_UID), VIEWER_UID, makeValidVote(VIEWER_UID), { landVotes: 1, trickName: "rewritten" }),
    );
  });

  it("a user CANNOT increment landVotes while recording a BAIL verdict", async () => {
    await seedDispute();
    await assertFails(
      voteAndTally(as(VIEWER_UID), VIEWER_UID, makeValidVote(VIEWER_UID, { verdict: "bail" }), { landVotes: 1 }),
    );
  });

  it("an unverified-email user CANNOT bump a tally", async () => {
    await seedDispute();
    await assertFails(voteAndTally(as(VIEWER_UID, false), VIEWER_UID, makeValidVote(VIEWER_UID), { landVotes: 1 }));
  });

  it("the setter CANNOT close their own dispute (status is server-side)", async () => {
    await seedDispute();
    await assertFails(updateDoc(disputeRef(as(P1_UID)), { status: "closed" }));
  });

  it("the setter CANNOT rewrite the judged video URL after the fact", async () => {
    await seedDispute();
    await assertFails(updateDoc(disputeRef(as(P1_UID)), { matchVideoUrl: PINNED_SET_URL }));
  });

  it("nobody can flip moderationStatus (takedown path is Admin SDK only)", async () => {
    await seedDispute();
    await assertFails(updateDoc(disputeRef(as(P1_UID)), { moderationStatus: "hidden" }));
  });
});

/* ────────────────────────────────────────────
 * UPDATE — tally decrement paired with a verdict retraction
 *
 * The -1 branch is what makes the delete → re-vote cycle net zero (stuffing
 * blocked by arithmetic, not by forbidding deletes) AND what lets the
 * account-deletion cascade reap verdicts from OPEN disputes.
 * ──────────────────────────────────────────── */

describe("disputes — tally decrement (paired vote-doc delete only)", () => {
  it("a voter CAN decrement landVotes when they delete their LAND verdict atomically", async () => {
    await seedDispute({ landVotes: 3 });
    await seedExistingVote(VIEWER_UID, "land");
    await assertSucceeds(retractVote(as(VIEWER_UID), VIEWER_UID, { landVotes: 2 }));
    expect(await readTally("landVotes")).toBe(2);
  });

  it("a voter CAN decrement bailVotes when they delete their BAIL verdict atomically", async () => {
    await seedDispute({ bailVotes: 2 });
    await seedExistingVote(VIEWER_UID, "bail");
    await assertSucceeds(retractVote(as(VIEWER_UID), VIEWER_UID, { bailVotes: 1 }));
  });

  it("erasure works on a CLOSED dispute (the -1 branch is deliberately not status-gated)", async () => {
    await seedDispute({ status: "closed", landVotes: 1 });
    await seedExistingVote(VIEWER_UID, "land");
    await assertSucceeds(retractVote(as(VIEWER_UID), VIEWER_UID, { landVotes: 0 }));
  });

  it("a voter CANNOT decrement the counter their verdict never fed (BAIL vote, LAND tally)", async () => {
    await seedDispute({ landVotes: 5, bailVotes: 1 });
    await seedExistingVote(VIEWER_UID, "bail");
    await assertFails(retractVote(as(VIEWER_UID), VIEWER_UID, { landVotes: 4 }));
  });

  it("a voter CANNOT decrement a tally without deleting their verdict doc", async () => {
    await seedDispute({ landVotes: 3 });
    await seedExistingVote(VIEWER_UID, "land");
    await assertFails(updateDoc(disputeRef(as(VIEWER_UID)), { landVotes: 2 }));
  });

  it("a user with NO verdict on file CANNOT decrement a tally", async () => {
    await seedDispute({ landVotes: 3 });
    await assertFails(updateDoc(disputeRef(as(VIEWER_UID)), { landVotes: 2 }));
  });

  it("a voter CANNOT decrement by more than 1", async () => {
    await seedDispute({ landVotes: 9 });
    await seedExistingVote(VIEWER_UID, "land");
    await assertFails(retractVote(as(VIEWER_UID), VIEWER_UID, { landVotes: 0 }));
  });

  it("a voter CANNOT push a tally below zero", async () => {
    await seedDispute({ landVotes: 0 });
    await seedExistingVote(VIEWER_UID, "land");
    await assertFails(retractVote(as(VIEWER_UID), VIEWER_UID, { landVotes: -1 }));
  });

  it("a voter CANNOT decrement someone ELSE's verdict off the board", async () => {
    await seedDispute({ landVotes: 1 });
    await seedExistingVote(OTHER_VIEWER_UID, "land");
    const ctx = as(VIEWER_UID);
    await assertFails(
      runTransaction(ctx.firestore(), async (tx) => {
        await tx.get(disputeRef(ctx));
        tx.delete(voteRef(ctx, OTHER_VIEWER_UID));
        tx.update(disputeRef(ctx), { landVotes: 0 });
      }),
    );
  });
});

/* ────────────────────────────────────────────
 * DELETE
 * ──────────────────────────────────────────── */

describe("disputes — delete is CLOSED to all clients (Gap B)", () => {
  // Gap B (delete + re-raise resets a live tally) — CLOSED. The client delete
  // is removed entirely now that verdicts are binding; the referee's
  // open → resolved close-out replaces it. Erasure of a user's VERDICTS still
  // works via the /disputeVotes owner-delete (see the disputeVotes suite).
  it("the setter who raised the dispute CANNOT delete it (client delete removed)", async () => {
    await seedDispute();
    await assertFails(deleteDoc(disputeRef(as(P1_UID))));
  });

  it("Gap B: a setter losing the vote CANNOT delete-and-reset a live tally", async () => {
    // The exact re-raise reset vector: a dispute with a live, unfavourable
    // tally cannot be wiped by its raiser.
    await seedDispute({ landVotes: 0, bailVotes: 5 });
    await assertFails(deleteDoc(disputeRef(as(P1_UID))));
  });

  it("the matcher CANNOT delete a dispute over their claim", async () => {
    await seedDispute();
    await assertFails(deleteDoc(disputeRef(as(P2_UID))));
  });

  it("a stranger CANNOT delete a dispute", async () => {
    await seedDispute();
    await assertFails(deleteDoc(disputeRef(as(VIEWER_UID))));
  });
});

/* ────────────────────────────────────────────
 * disputeVotes
 * ──────────────────────────────────────────── */

describe("disputeVotes", () => {
  it("any signed-in user CAN read a verdict doc", async () => {
    await seedDispute();
    await seedExistingVote(VIEWER_UID);
    await assertSucceeds(getDoc(voteRef(as(OTHER_VIEWER_UID), VIEWER_UID)));
  });

  it("rejects a vote doc whose id doesn't match uid_disputeId", async () => {
    await seedDispute();
    const ctx = as(VIEWER_UID);
    await assertFails(
      setDoc(doc(ctx.firestore(), "disputeVotes", `someone-else_${DISPUTE_ID}`), makeValidVote(VIEWER_UID)),
    );
  });

  it("rejects a vote doc claiming another user's uid", async () => {
    await seedDispute();
    await assertFails(setDoc(voteRef(as(VIEWER_UID), VIEWER_UID), makeValidVote(OTHER_VIEWER_UID)));
  });

  it("rejects a verdict outside the land/bail enum", async () => {
    await seedDispute();
    await assertFails(setDoc(voteRef(as(VIEWER_UID), VIEWER_UID), makeValidVote(VIEWER_UID, { verdict: "maybe" })));
  });

  it("rejects a vote on a dispute that does not exist", async () => {
    await assertFails(setDoc(voteRef(as(VIEWER_UID), VIEWER_UID), makeValidVote(VIEWER_UID)));
  });

  it("rejects a back-dated createdAt", async () => {
    await seedDispute();
    await assertFails(
      setDoc(voteRef(as(VIEWER_UID), VIEWER_UID), makeValidVote(VIEWER_UID, { createdAt: new Date(0) })),
    );
  });

  it("rejects an update to an existing verdict (verdicts are immutable)", async () => {
    await seedDispute();
    await seedExistingVote(VIEWER_UID);
    await assertFails(updateDoc(voteRef(as(VIEWER_UID), VIEWER_UID), { verdict: "bail" }));
  });

  it("the vote owner CAN delete an orphaned verdict doc whose dispute is gone", async () => {
    await seedExistingVote(VIEWER_UID);
    await assertSucceeds(deleteDoc(voteRef(as(VIEWER_UID), VIEWER_UID)));
  });

  it("the vote owner CAN delete a verdict whose tally is already at zero (nothing to subtract)", async () => {
    // Reachable after an Admin-SDK close-out, or after a dispute is deleted
    // and re-raised from a zeroed tally. Blocking it would strand the doc.
    await seedDispute({ landVotes: 0 });
    await seedExistingVote(VIEWER_UID, "land");
    await assertSucceeds(deleteDoc(voteRef(as(VIEWER_UID), VIEWER_UID)));
  });

  // Ballot-stuffing replay guard. A bare delete would reset the +1 branch's
  // !exists() check while leaving the original increment on the board, so
  // the delete has to carry its own -1.
  it("the vote owner CANNOT delete a verdict without the paired tally decrement", async () => {
    await seedDispute({ landVotes: 1 });
    await seedExistingVote(VIEWER_UID, "land");
    await assertFails(deleteDoc(voteRef(as(VIEWER_UID), VIEWER_UID)));
  });

  it("the vote owner CANNOT delete a verdict by decrementing the OTHER tally", async () => {
    await seedDispute({ landVotes: 1, bailVotes: 1 });
    await seedExistingVote(VIEWER_UID, "land");
    await assertFails(retractVote(as(VIEWER_UID), VIEWER_UID, { bailVotes: 0 }));
  });

  it("a stranger CANNOT delete someone else's verdict doc", async () => {
    await seedDispute({ status: "closed", landVotes: 0 });
    await seedExistingVote(VIEWER_UID);
    await assertFails(deleteDoc(voteRef(as(OTHER_VIEWER_UID), VIEWER_UID)));
  });
});
