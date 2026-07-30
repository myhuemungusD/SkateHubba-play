/**
 * Games — binding-dispute Phase 2 red-team: the pendingReview freeze, the
 * setter's accept / raise-dispute moves, and the communityReview freeze.
 *
 * The feature replaces the instant honor swap on a landed claim with a FREEZE:
 *
 *   matching --matcher landed--> pendingReview          [game frozen]
 *   pendingReview --setter accepts--> setting           [deferred honor swap]
 *   pendingReview --setter disputes--> communityReview  [handed to the crowd]
 *   communityReview --referee (Admin SDK)--> ...        [no client write]
 *
 * These tests prove:
 *   • the matcher's landed submission CAN enter pendingReview with everything
 *     (roles / turn / letters / history) pinned, and CANNOT seize roles or
 *     advance the turn on that same write;
 *   • only the SETTER can accept or raise a dispute out of pendingReview — the
 *     matcher and third parties are denied;
 *   • ACCEPT applies the exact honor swap; RAISE-DISPUTE leaves roles/letters
 *     frozen;
 *   • communityReview is fully frozen to clients (letters/turn/winner/status/
 *     forfeit all denied);
 *   • BACKWARD COMPAT: today's client's instant honor landed→setting swap STILL
 *     passes (the additive change must not break in-flight clients).
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { serverTimestamp, updateDoc } from "firebase/firestore";
import { setupRulesTestEnv, authedContext, gameDoc, seedGameForUpdate } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-games-pendingreview-redteam";

const P1_UID = "p1-alice"; // setter of the disputed turn
const P2_UID = "p2-bob"; // matcher / claimant

// Bucket-pinned per the audit-P2 host pin — an off-bucket URL would be rejected
// for a reason unrelated to the transition each test exercises.
const VALID_MATCH_URL = "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/match.webm";

const TURN = 4;
const future = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

const getEnv = setupRulesTestEnv(PROJECT_ID);

function asP1() {
  return authedContext(getEnv(), P1_UID);
}
function asP2() {
  return authedContext(getEnv(), P2_UID);
}
function asViewer() {
  return authedContext(getEnv(), "v-viewer");
}

/** A game in `matching`, P1 set the trick, P2 (matcher) is on the clock. */
function seedMatching(overrides: Record<string, unknown> = {}) {
  return seedGameForUpdate(
    getEnv(),
    "g",
    { player1Uid: P1_UID, player2Uid: P2_UID },
    {
      phase: "matching",
      currentSetter: P1_UID,
      currentTurn: P2_UID,
      turnNumber: TURN,
      matchVideoUrl: null,
      ...overrides,
    },
  );
}

/** A game frozen in `pendingReview`, awaiting P1 (the setter)'s decision. */
function seedPendingReview(overrides: Record<string, unknown> = {}) {
  return seedGameForUpdate(
    getEnv(),
    "g",
    { player1Uid: P1_UID, player2Uid: P2_UID },
    {
      phase: "pendingReview",
      currentSetter: P1_UID,
      currentTurn: P2_UID,
      turnNumber: TURN,
      reviewFor: P2_UID,
      reviewDeadline: future(),
      matchVideoUrl: VALID_MATCH_URL,
      ...overrides,
    },
  );
}

/** A game frozen in `communityReview` (a dispute was raised). */
function seedCommunityReview(overrides: Record<string, unknown> = {}) {
  return seedGameForUpdate(
    getEnv(),
    "g",
    { player1Uid: P1_UID, player2Uid: P2_UID },
    {
      phase: "communityReview",
      currentSetter: P1_UID,
      currentTurn: P2_UID,
      turnNumber: TURN,
      reviewFor: P2_UID,
      reviewDeadline: future(),
      matchVideoUrl: VALID_MATCH_URL,
      ...overrides,
    },
  );
}

/* ────────────────────────────────────────────
 * matching → pendingReview (the freeze)
 * ──────────────────────────────────────────── */

describe("matching → pendingReview (landed claim freezes the game)", () => {
  it("the matcher CAN freeze a landed claim into pendingReview", async () => {
    await seedMatching();
    await assertSucceeds(
      updateDoc(gameDoc(asP2(), "g"), {
        phase: "pendingReview",
        reviewFor: P2_UID, // matcher = opponent of setter
        reviewDeadline: future(),
        matchVideoUrl: VALID_MATCH_URL,
        turnDeadline: future(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("DENIED: seizing the setter role while entering pendingReview", async () => {
    await seedMatching();
    await assertFails(
      updateDoc(gameDoc(asP2(), "g"), {
        phase: "pendingReview",
        currentSetter: P2_UID, // SEIZE — must stay P1
        reviewFor: P2_UID,
        reviewDeadline: future(),
        matchVideoUrl: VALID_MATCH_URL,
        turnDeadline: future(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("DENIED: advancing turnNumber while entering pendingReview (nothing resolves yet)", async () => {
    await seedMatching();
    await assertFails(
      updateDoc(gameDoc(asP2(), "g"), {
        phase: "pendingReview",
        turnNumber: TURN + 1, // must stay TURN — the turn is not over
        reviewFor: P2_UID,
        reviewDeadline: future(),
        matchVideoUrl: VALID_MATCH_URL,
        turnDeadline: future(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("DENIED: awarding a letter while entering pendingReview", async () => {
    await seedMatching();
    await assertFails(
      updateDoc(gameDoc(asP2(), "g"), {
        phase: "pendingReview",
        p2Letters: 1, // no letters move on a landed freeze
        reviewFor: P2_UID,
        reviewDeadline: future(),
        matchVideoUrl: VALID_MATCH_URL,
        turnDeadline: future(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("DENIED: appending a TurnRecord while entering pendingReview (no resolution)", async () => {
    await seedMatching();
    await assertFails(
      updateDoc(gameDoc(asP2(), "g"), {
        phase: "pendingReview",
        turnHistory: [{ turnNumber: TURN, landed: true, letterTo: null }],
        reviewFor: P2_UID,
        reviewDeadline: future(),
        matchVideoUrl: VALID_MATCH_URL,
        turnDeadline: future(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("DENIED: reviewFor naming the SETTER instead of the matcher", async () => {
    await seedMatching();
    await assertFails(
      updateDoc(gameDoc(asP2(), "g"), {
        phase: "pendingReview",
        reviewFor: P1_UID, // must be the matcher (opponent of setter)
        reviewDeadline: future(),
        matchVideoUrl: VALID_MATCH_URL,
        turnDeadline: future(),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

/* ────────────────────────────────────────────
 * pendingReview → setting (ACCEPT — deferred honor swap)
 * ──────────────────────────────────────────── */

describe("pendingReview → setting (setter ACCEPTS the claim)", () => {
  const acceptPayload = (overrides: Record<string, unknown> = {}) => ({
    phase: "setting",
    currentSetter: P2_UID, // rotate to the matcher
    currentTurn: P2_UID,
    turnNumber: TURN + 1,
    turnHistory: [{ turnNumber: TURN, landed: true, letterTo: null }],
    reviewFor: null,
    reviewDeadline: null,
    turnDeadline: future(),
    updatedAt: serverTimestamp(),
    ...overrides,
  });

  it("the SETTER CAN accept — roles rotate to the matcher, turnNumber +1, review cleared", async () => {
    await seedPendingReview();
    await assertSucceeds(updateDoc(gameDoc(asP1(), "g"), acceptPayload()));
  });

  it("DENIED: the MATCHER cannot accept their own claim", async () => {
    await seedPendingReview();
    await assertFails(updateDoc(gameDoc(asP2(), "g"), acceptPayload()));
  });

  it("DENIED: a third party cannot accept", async () => {
    await seedPendingReview();
    await assertFails(updateDoc(gameDoc(asViewer(), "g"), acceptPayload()));
  });

  it("DENIED: accept that keeps the setter role instead of rotating (turn seize)", async () => {
    await seedPendingReview();
    await assertFails(updateDoc(gameDoc(asP1(), "g"), acceptPayload({ currentSetter: P1_UID, currentTurn: P1_UID })));
  });

  it("DENIED: accept that freezes turnNumber instead of +1", async () => {
    await seedPendingReview();
    await assertFails(updateDoc(gameDoc(asP1(), "g"), acceptPayload({ turnNumber: TURN })));
  });

  it("DENIED: accept that also awards a letter", async () => {
    await seedPendingReview();
    await assertFails(updateDoc(gameDoc(asP1(), "g"), acceptPayload({ p2Letters: 1 })));
  });
});

/* ────────────────────────────────────────────
 * pendingReview → communityReview (RAISE DISPUTE)
 * ──────────────────────────────────────────── */

describe("pendingReview → communityReview (setter RAISES a dispute)", () => {
  const disputePayload = (overrides: Record<string, unknown> = {}) => ({
    phase: "communityReview",
    reviewDeadline: future(), // fresh vote window
    updatedAt: serverTimestamp(),
    ...overrides,
  });

  it("the SETTER CAN raise a dispute — roles/turn/letters all stay frozen", async () => {
    await seedPendingReview();
    await assertSucceeds(updateDoc(gameDoc(asP1(), "g"), disputePayload()));
  });

  it("DENIED: the MATCHER cannot raise a dispute over their own claim", async () => {
    await seedPendingReview();
    await assertFails(updateDoc(gameDoc(asP2(), "g"), disputePayload()));
  });

  it("DENIED: a third party cannot raise a dispute", async () => {
    await seedPendingReview();
    await assertFails(updateDoc(gameDoc(asViewer(), "g"), disputePayload()));
  });

  it("DENIED: raising a dispute while seizing the setter role", async () => {
    await seedPendingReview();
    await assertFails(updateDoc(gameDoc(asP1(), "g"), disputePayload({ currentSetter: P2_UID })));
  });

  it("DENIED: raising a dispute while advancing the turn", async () => {
    await seedPendingReview();
    await assertFails(updateDoc(gameDoc(asP1(), "g"), disputePayload({ turnNumber: TURN + 1 })));
  });

  it("DENIED: raising a dispute while awarding a letter", async () => {
    await seedPendingReview();
    await assertFails(updateDoc(gameDoc(asP1(), "g"), disputePayload({ p2Letters: 1 })));
  });

  it("DENIED: raising a dispute while appending a TurnRecord (history must stay frozen)", async () => {
    await seedPendingReview();
    await assertFails(
      updateDoc(gameDoc(asP1(), "g"), disputePayload({ turnHistory: [{ turnNumber: TURN, landed: true }] })),
    );
  });
});

/* ────────────────────────────────────────────
 * communityReview is FROZEN to all clients
 * ──────────────────────────────────────────── */

describe("communityReview is frozen (only the Admin-SDK referee resolves it)", () => {
  it("DENIED: the setter cannot award a letter from communityReview", async () => {
    await seedCommunityReview();
    await assertFails(updateDoc(gameDoc(asP1(), "g"), { p2Letters: 1, updatedAt: serverTimestamp() }));
  });

  it("DENIED: the setter cannot rotate the turn from communityReview", async () => {
    await seedCommunityReview();
    await assertFails(
      updateDoc(gameDoc(asP1(), "g"), {
        phase: "setting",
        currentSetter: P2_UID,
        currentTurn: P2_UID,
        turnNumber: TURN + 1,
        turnDeadline: future(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("DENIED: the setter cannot declare a winner from communityReview", async () => {
    await seedCommunityReview();
    await assertFails(
      updateDoc(gameDoc(asP1(), "g"), { status: "complete", winner: P1_UID, updatedAt: serverTimestamp() }),
    );
  });

  it("DENIED: the matcher cannot flip status from communityReview", async () => {
    await seedCommunityReview();
    await assertFails(updateDoc(gameDoc(asP2(), "g"), { status: "forfeit", winner: P2_UID }));
  });

  it("DENIED: an expired turnDeadline does not open a forfeit path on a frozen game", async () => {
    // The forfeit branch is gated to setting/matching only — communityReview is
    // not a forfeit phase even with an expired deadline.
    await seedCommunityReview({ turnDeadline: new Date(Date.now() - 60_000) });
    await assertFails(updateDoc(gameDoc(asP1(), "g"), { status: "forfeit", winner: P1_UID }));
  });
});

/* ────────────────────────────────────────────
 * BACKWARD COMPAT — today's client is not broken
 * ──────────────────────────────────────────── */

describe("BACKWARD COMPAT: the instant honor landed→setting swap still works", () => {
  it("the matcher's instant landed swap (roles rotate, turnNumber +1) STILL passes", async () => {
    // This is exactly what the current production client does on a landed
    // claim. The pendingReview freeze is ADDITIVE — this path must keep working
    // through the rules auto-deploy until the freeze-first client rolls out.
    await seedGameForUpdate(
      getEnv(),
      "g",
      { player1Uid: P1_UID, player2Uid: P2_UID },
      { phase: "matching", currentSetter: P1_UID, currentTurn: P2_UID, turnNumber: TURN, matchVideoUrl: null },
    );
    await assertSucceeds(
      updateDoc(gameDoc(asP2(), "g"), {
        phase: "setting",
        currentSetter: P2_UID,
        currentTurn: P2_UID,
        turnNumber: TURN + 1,
        turnHistory: [{ turnNumber: TURN, landed: true, letterTo: null }],
        matchVideoUrl: VALID_MATCH_URL,
        turnDeadline: future(),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});
