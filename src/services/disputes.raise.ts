/**
 * Setter-facing trigger: send a matcher's honor-system "I landed it" claim to
 * the community — the BINDING community trick-dispute (Phase 3).
 *
 * A landed claim no longer resolves instantly. `submitMatchAttempt` FREEZES the
 * game in `pendingReview`, naming the matcher in `reviewFor` while
 * `currentSetter`/`turnNumber` still point at the disputed turn. From that
 * frozen state the setter either accepts (`acceptLanded`) or raises a binding
 * dispute here.
 *
 * `raiseDispute` is now binding on game state. In ONE transaction it:
 *   1. flips the frozen game `pendingReview → communityReview`, opening a 24h
 *      vote window (`reviewDeadline`) while pinning roles, turn, letters and
 *      turnHistory unchanged, and
 *   2. creates the `disputes/{gameId}_{turnNumber}` doc (status 'open',
 *      tallies 0), sourcing every denormalized field from the FROZEN game state
 *      — NOT from turnHistory, because the disputed turn is not in history yet.
 *
 * The community's majority vote is resolved later by the admin "dispute
 * referee" (Phase 4), which writes letters, turn order and the public stats.
 *
 * Gap A (role self-assertion) is closed by the freeze: the `disputes` create
 * rule binds `setterUid == game.currentSetter && turnNumber == game.turnNumber
 * && game.phase == 'pendingReview'`, so only the real frozen setter of the real
 * frozen turn can raise. See docs/DISPUTE_BINDING_DESIGN.md §3 and §5.
 */

import { doc, runTransaction, serverTimestamp, Timestamp } from "firebase/firestore";
import { requireAuth, requireDb } from "../firebase";
import { toGameDoc, type GameDoc } from "./games.mappers";
import { TURN_DURATION_MS } from "./turnDuration";
import { disputeId } from "./disputes.mappers";

/** The frozen-game fields the dispute gate reasons about. */
type DisputeGate = Pick<GameDoc, "status" | "phase" | "currentSetter" | "reviewFor" | "matchVideoUrl">;

/**
 * Single source of truth for dispute eligibility, in the order the setter would
 * hit the failures. Returns a user-facing message, or null when the frozen
 * claim may be sent to the community.
 *
 * Shared by {@link canRaiseDispute} (the UI's affordance gate) and
 * {@link raiseDispute} (the client-side write guard) so the button and the
 * write can never disagree about what is disputable.
 *
 * The binding flow gates on the FROZEN game state (not a turnHistory record):
 * the game must still be parked in `pendingReview` and the caller must be the
 * frozen setter. The Firestore rules re-derive the same setter/turn binding
 * against the live game doc (Gap A closure), so unlike the old post-hoc hook
 * these checks are backed server-side — they are surfaced here for a clean
 * error rather than a raw permission-denied.
 */
function disputeBlocker(game: DisputeGate, uid: string): string | null {
  if (game.status !== "active") return "This game is already over.";
  if (game.phase !== "pendingReview") return "There's no landed claim awaiting review.";
  if (game.currentSetter !== uid) return "Only the setter can send this call to the community.";
  if (!game.reviewFor) return "This claim has no matcher for the community to judge.";
  if (!game.matchVideoUrl) return "There's no match video for the community to judge.";
  return null;
}

/**
 * True when `uid` may send this frozen landed claim to the community.
 *
 * Pure predicate over the frozen game state — no reads, no writes. This is the
 * gate the setter's "Send to the community" affordance should render against.
 * It deliberately does NOT know whether a dispute already exists for the turn;
 * that check needs a read and is enforced inside {@link raiseDispute}, which
 * throws rather than silently overwriting a live tally.
 */
export function canRaiseDispute(game: DisputeGate, uid: string): boolean {
  return disputeBlocker(game, uid) === null;
}

/**
 * Raise a BINDING community dispute on the frozen honor-system landed claim.
 *
 * `runTransaction` because the game flip and the dispute create must be atomic
 * (a half-applied dispute — game flipped but no doc, or vice versa — would
 * corrupt the freeze) and because the create must observe an authoritative
 * "does this dispute already exist" read.
 *
 * The doc id is deterministic (`{gameId}_{turnNumber}`), so a transaction retry
 * re-runs the exists check rather than duplicating a dispute. An existing doc
 * throws instead of overwriting: re-raising would reset a live tally, the one
 * way a setter could launder an unfavourable crowd verdict. Overwrite
 * protection is genuinely enforced server-side (the disputes rule allows create
 * only when the doc doesn't already exist).
 *
 * The turn number is taken from the frozen game state — there is no turn to
 * select, only the single claim currently under review.
 */
export async function raiseDispute(gameId: string): Promise<void> {
  const uid = requireAuth().currentUser?.uid;
  if (!uid) throw new Error("You must be signed in to send a call to the community.");

  const db = requireDb();
  const gameRef = doc(db, "games", gameId);

  await runTransaction(db, async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists()) throw new Error("Game not found");

    const game = toGameDoc(gameSnap);
    const blocker = disputeBlocker(game, uid);
    if (blocker) throw new Error(blocker);

    // A null blocker proves the game is frozen in pendingReview with a matcher
    // and a match video — narrow the two nullable fields for the writes below.
    const matcherUid = game.reviewFor as string;
    const matchVideoUrl = game.matchVideoUrl as string;

    // Second read must precede any write. The deterministic id binds to the
    // frozen turnNumber — the same coordinate the create rule re-checks.
    const disputeRef = doc(db, "disputes", disputeId(gameId, game.turnNumber));
    const existing = await tx.get(disputeRef);
    if (existing.exists()) throw new Error("This turn has already been sent to the community.");

    const setterUsername = game.currentSetter === game.player1Uid ? game.player1Username : game.player2Username;
    const matcherUsername = matcherUid === game.player1Uid ? game.player1Username : game.player2Username;

    // 1) Flip pendingReview → communityReview: open the vote window. Roles,
    // turn, letters, turnHistory, reviewFor and turnDeadline all stay pinned
    // (the rules' communityReview arm enforces exactly this).
    tx.update(gameRef, {
      phase: "communityReview",
      reviewDeadline: Timestamp.fromMillis(Date.now() + TURN_DURATION_MS),
      updatedAt: serverTimestamp(),
    });

    // 2) Create the dispute doc from the FROZEN game state (not turnHistory —
    // the disputed turn is not in history yet). Denormalized so the feed renders
    // a dispute card without reading the game doc (non-players cannot read it).
    tx.set(disputeRef, {
      gameId,
      turnNumber: game.turnNumber,
      trickName: game.currentTrickName || "Trick",
      setterUid: game.currentSetter,
      setterUsername,
      matcherUid,
      matcherUsername,
      setVideoUrl: game.currentTrickVideoUrl ?? null,
      matchVideoUrl,
      spotId: game.spotId ?? null,
      createdAt: serverTimestamp(),
      status: "open",
      moderationStatus: "active",
      landVotes: 0,
      bailVotes: 0,
    });
  });
}
