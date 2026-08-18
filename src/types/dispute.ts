/**
 * Shared types for community-judged trick disputes.
 *
 * When a matcher claims they landed the set trick, the setter can send the
 * call to the community instead of taking it on the honor system. The clip
 * enters the feed and viewers rule LAND or BAIL.
 *
 * Lives here (rather than beside the service) so UI components can import
 * the contract without dragging the Firebase SDK surface along — same
 * arrangement as `src/types/clip.ts`.
 */
import type { Timestamp } from "firebase/firestore";

/** How a viewer ruled on a disputed trick. */
export type DisputeVerdict = "land" | "bail";

/**
 * The referee's ruling on a closed dispute — a superset of `DisputeVerdict`
 * because the server can also close on a tie or on no usable votes at all.
 * Mirrors the union `decideDisputeResolution` produces.
 */
export type DisputeOutcome = "land" | "bail" | "tie" | "none";

/**
 * Lifecycle of a dispute.
 *
 *  • open   — accepting community verdicts
 *  • closed — voting finished; `landVotes`/`bailVotes` are final
 *
 * NOTE: a closed dispute does NOT currently alter game state. The verdict is
 * recorded and displayed, but the turn resolves on the honor system exactly
 * as it does today. Making the crowd verdict binding is a deliberate,
 * separate step — it means writing letters and advancing turns from a vote
 * tally, which needs its own transactional close-out path and rules work.
 * The shape here is designed so that flip is additive.
 */
export type DisputeStatus = "open" | "closed";

/**
 * Client-writable moderation state, mirroring `Clip`. Clients only ever
 * create disputes as `active`; transitions to `hidden` happen server-side
 * (Admin SDK) in response to a report.
 */
export type DisputeModerationStatus = "active" | "hidden";

/**
 * A disputed trick awaiting (or holding) the community's verdict.
 *
 * Document id is `${gameId}_${turnNumber}` — deterministic, so the create is
 * idempotent under transaction retry and a turn can only be disputed once.
 *
 * `landVotes` / `bailVotes` are server-maintained aggregates of the matching
 * `disputeVotes` subset. Writes are gated by Firestore rules to deltas of +1
 * paired with the corresponding vote-doc create, so both fields are safe to
 * read directly for the tally without a fan-out count query — the same
 * pattern `clips.upvoteCount` already uses.
 */
export interface Dispute {
  id: string;
  gameId: string;
  turnNumber: number;
  trickName: string;
  /** The player who set the trick — the one who raised the dispute. */
  setterUid: string;
  setterUsername: string;
  /** The player whose "I landed it" claim is being judged. */
  matcherUid: string;
  matcherUsername: string;
  /** The set trick, for reference while judging. May be absent on old turns. */
  setVideoUrl: string | null;
  /** The attempt under judgement. This is the clip the feed plays. */
  matchVideoUrl: string;
  spotId: string | null;
  createdAt: Timestamp | null;
  status: DisputeStatus;
  moderationStatus: DisputeModerationStatus;
  landVotes: number;
  bailVotes: number;
  /**
   * The referee's ruling, written by `api/cron/resolve-expired-disputes.ts`
   * when the dispute closes. Absent while the dispute is open (and on any doc
   * carrying an unrecognised value). `"none"` means the vote window expired
   * without a usable tally; `"tie"` means land and bail votes were level.
   */
  verdict?: DisputeOutcome;
}

/** A single viewer's verdict on a dispute. */
export interface DisputeVote {
  uid: string;
  disputeId: string;
  verdict: DisputeVerdict;
  createdAt: Timestamp | null;
}

/**
 * The viewer's relationship to a dispute in the feed.
 *
 * `ownVerdict` is null when they haven't ruled yet. `canVote` is false for
 * the two players in the game — you never get to judge your own trick — and
 * for a dispute that has already closed.
 */
export interface DisputeViewerState {
  ownVerdict: DisputeVerdict | null;
  canVote: boolean;
}

/** Live tally shown on the card. */
export interface DisputeTally {
  land: number;
  bail: number;
}

/** Total votes cast on a dispute. */
export function totalVotes(tally: DisputeTally): number {
  return tally.land + tally.bail;
}

/**
 * Share of LAND votes, 0–1. Returns 0.5 for an empty tally so the meter
 * renders centred rather than collapsed before anyone has ruled.
 */
export function landShare(tally: DisputeTally): number {
  const total = totalVotes(tally);
  if (total === 0) return 0.5;
  return tally.land / total;
}
