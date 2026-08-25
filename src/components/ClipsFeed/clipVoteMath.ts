/**
 * Optimistic arithmetic for the thumbs controls.
 *
 * Kept pure and separate from the controller because this is the part that is
 * easy to get subtly wrong — a flip (up → down) moves TWO counters, and doing
 * it as "remove then add" against stale state double-decrements. One function,
 * fully enumerated, unit-tested.
 */

import type { ClipVoteState } from "../../services/clips.upvotes";

/** The vote the viewer is asking for: thumbs up, thumbs down, or withdrawn. */
export type VoteValue = 1 | -1 | null;

/** A clip nobody has voted on — the default before hydration resolves. */
export const NO_VOTE: ClipVoteState = { upvoteCount: 0, downvoteCount: 0, myVote: null };

/**
 * What tapping `pressed` does to a clip currently in `state`.
 *
 * Tapping the thumb you already gave withdraws it (the control is a toggle,
 * which is why its `aria-pressed` is meaningful); tapping the other one flips.
 * Returns the vote to send to the server — `null` meaning "delete my vote".
 */
export function nextVoteFor(state: ClipVoteState, pressed: 1 | -1): VoteValue {
  return state.myVote === pressed ? null : pressed;
}

/**
 * Project `state` forward as if the server had accepted `next`.
 *
 * Counts are clamped at zero: the aggregate on the clip doc can legitimately
 * lag the vote docs (a backfilled clip, a rules-rejected write elsewhere), and
 * rendering "-1 downvotes" would be a worse lie than rendering "0".
 */
export function applyVote(state: ClipVoteState, next: VoteValue): ClipVoteState {
  const up = state.upvoteCount - (state.myVote === 1 ? 1 : 0) + (next === 1 ? 1 : 0);
  const down = state.downvoteCount - (state.myVote === -1 ? 1 : 0) + (next === -1 ? 1 : 0);
  return {
    upvoteCount: Math.max(0, up),
    downvoteCount: Math.max(0, down),
    myVote: next,
  };
}

/** True when two states are identical — the guard the rollback path uses. */
export function sameVoteState(a: ClipVoteState, b: ClipVoteState): boolean {
  return a.upvoteCount === b.upvoteCount && a.downvoteCount === b.downvoteCount && a.myVote === b.myVote;
}
