/**
 * Setter-facing trigger: send a matcher's honor-system "I landed it" claim to
 * the community instead of accepting it.
 *
 * NOT BINDING ON GAME STATE. `raiseDispute` reads the game doc and writes a
 * `disputes/{gameId}_{turnNumber}` document — nothing else. It never writes
 * letters, never advances `turnNumber`, never touches `phase`, `currentTurn`
 * or `turnHistory`. The turn has already resolved on the honor system by the
 * time a dispute can be raised, and it stays resolved exactly as it is today.
 * The crowd verdict is recorded and displayed only.
 *
 * That is also why this is a *post-hoc* hook rather than a branch inside
 * `submitMatchAttempt`: the dispute sources its denormalized fields from the
 * already-appended `turnHistory` record, so `submitMatchAttempt` needed no
 * change at all and the honor-system resolution path is bit-for-bit
 * unchanged.
 */

import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { requireAuth, requireDb } from "../firebase";
import { toGameDoc, type TurnRecord } from "./games.mappers";
import { disputeId } from "./disputes.mappers";

/**
 * Single source of truth for dispute eligibility, in the order the setter
 * would hit the failures. Returns a user-facing message, or null when the
 * turn may be sent to the community.
 *
 * Shared by {@link canRaiseDispute} (the UI's affordance gate) and
 * {@link raiseDispute} (the client-side write guard) so the button and the
 * write can never disagree about what is disputable.
 *
 * NOT authoritative. Firestore rules cannot verify who set turn N — the
 * `setterUid == request.auth.uid` check on the create only proves the caller
 * isn't impersonating someone else. Everything below (the turn exists, it was
 * landed, it has a match video, and the caller really is that turn's setter)
 * is client-side defence-in-depth over data the server does not re-derive.
 */
function disputeBlocker(turn: TurnRecord | undefined, uid: string): string | null {
  if (!turn) return "That turn hasn't finished yet.";
  if (turn.setterUid !== uid) return "Only the setter can send this call to the community.";
  // A matcher who admits a miss has already taken the letter — there is no
  // claim to judge. Only a "landed" claim can go to the crowd.
  if (!turn.landed) return "Only a landed claim can be sent to the community.";
  if (!turn.matchVideoUrl) return "There's no match video for the community to judge.";
  return null;
}

/**
 * True when `uid` may send this completed turn to the community.
 *
 * Pure predicate over a `TurnRecord` — no reads, no writes. This is the gate
 * the setter's "Send to the community" affordance should render against.
 * It deliberately does NOT know whether a dispute already exists for the
 * turn; that check needs a read and is enforced inside `raiseDispute`, which
 * throws rather than silently overwriting.
 */
export function canRaiseDispute(turn: TurnRecord | undefined, uid: string): boolean {
  return disputeBlocker(turn, uid) === null;
}

/**
 * Send a completed, honor-system-landed turn to the community for judgement.
 *
 * `runTransaction` because this reads game state (CLAUDE.md: game reads and
 * the write that depends on them are transactional, no exceptions) and
 * because the create must observe an authoritative "does this dispute
 * already exist" read. The transaction's only write is the dispute doc — the
 * game doc is read-only here.
 *
 * The doc id is deterministic (`{gameId}_{turnNumber}`), so a transaction
 * retry re-runs the exists check rather than duplicating a dispute. An
 * existing doc throws instead of overwriting: re-raising would reset a live
 * tally, which is the one way a setter could launder an unfavourable crowd
 * verdict. Overwrite protection is genuinely enforced server-side (the
 * disputes rule allows create only when the doc doesn't already exist); the
 * turn-eligibility checks below are not — see `disputeBlocker`.
 */
export async function raiseDispute(gameId: string, turnNumber: number): Promise<void> {
  const uid = requireAuth().currentUser?.uid;
  if (!uid) throw new Error("You must be signed in to send a call to the community.");

  const db = requireDb();
  const gameRef = doc(db, "games", gameId);
  const disputeRef = doc(db, "disputes", disputeId(gameId, turnNumber));

  await runTransaction(db, async (tx) => {
    // Both reads issued together so the transaction's read phase costs a
    // single round-trip (same shape as `upvoteClip`).
    const [gameSnap, existing] = await Promise.all([tx.get(gameRef), tx.get(disputeRef)]);
    if (!gameSnap.exists()) throw new Error("Game not found");
    if (existing.exists()) throw new Error("This turn has already been sent to the community.");

    const game = toGameDoc(gameSnap);
    const turn = (game.turnHistory ?? []).find((t) => t.turnNumber === turnNumber);

    const blocker = disputeBlocker(turn, uid);
    if (blocker) throw new Error(blocker);
    // A null blocker proves `turn` exists and carries a non-empty
    // matchVideoUrl, but TS can't see through the helper. Narrowing cast
    // (never `as any`) rather than a redundant re-check, which would be an
    // unreachable branch the coverage gate could never satisfy.
    const disputable = turn as TurnRecord & { matchVideoUrl: string };

    // Denormalized so the feed renders a dispute card without reading the
    // game doc (which non-players cannot read).
    tx.set(disputeRef, {
      gameId,
      turnNumber,
      trickName: disputable.trickName,
      setterUid: disputable.setterUid,
      setterUsername: disputable.setterUsername,
      matcherUid: disputable.matcherUid,
      matcherUsername: disputable.matcherUsername,
      setVideoUrl: disputable.setVideoUrl ?? null,
      matchVideoUrl: disputable.matchVideoUrl,
      spotId: game.spotId ?? null,
      createdAt: serverTimestamp(),
      status: "open",
      moderationStatus: "active",
      landVotes: 0,
      bailVotes: 0,
    });
  });
}
