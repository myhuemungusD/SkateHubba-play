/**
 * Legacy upvote-only surface for clips.
 *
 * Everything here is a thin projection of `clips.votes.ts`, which owns the
 * up/down vote model (`clipVotes.value`, paired `upvoteCount` /
 * `downvoteCount` deltas). This module exists so callers written against the
 * pre-downvote API — which knew only a single count and an "already upvoted"
 * boolean — keep working unchanged while the UI migrates to
 * {@link ClipVoteState}. There is NO second implementation behind it: one
 * transaction body, one set of guarantees, two views of the result.
 *
 * New code should import `castClipVote` / `removeClipVote` /
 * `fetchClipVoteState` from `./clips` directly. When the last caller of this
 * module is gone, delete the file — not the logic.
 */

import type { ClipVoteState } from "./clips.votes";
import { castClipVote, fetchClipVoteState, removeClipVote } from "./clips.votes";

/**
 * Legacy error aliases.
 *
 * These are ALIASES, not subclasses: `err instanceof AlreadyUpvotedError` and
 * `err instanceof AlreadyVotedError` are the same check, so a caller on either
 * side of the migration catches the same object. Only the exported name
 * differs — `err.name` reports the canonical vote-model name.
 */
export {
  AlreadyVotedError as AlreadyUpvotedError,
  SelfVoteError as SelfUpvoteError,
  NotVotedError as NotUpvotedError,
} from "./clips.votes";

/**
 * The up/down surface, re-exported from this module's path.
 *
 * `castClipVote` is exposed here as `voteClip` — the name the feed reads
 * naturally at the call site ("vote this clip"), while the canonical module
 * keeps the more precise `castClipVote`. Same function either way; there is
 * no wrapper.
 */
export {
  castClipVote as voteClip,
  castClipVote,
  fetchClipVoteState,
  removeClipVote,
  AlreadyVotedError,
  NotVotedError,
  SelfVoteError,
} from "./clips.votes";
export type { ClipVoteState, ClipVoteValue, ClipForVoteHydration } from "./clips.votes";

/** Per-clip upvote state in the pre-downvote shape. */
export interface ClipUpvoteState {
  count: number;
  alreadyUpvoted: boolean;
}

/** Minimal clip shape required to hydrate upvote state. */
export interface ClipForUpvoteHydration {
  id: string;
  upvoteCount: number;
  playerUid: string;
}

/**
 * Hydrate upvote state for a page of clips.
 *
 * Delegates to {@link fetchClipVoteState} and projects away the downvote half.
 * The supplied clips carry no `downvoteCount` in this shape, so 0 is passed
 * through — harmless, because the projection discards it either way and the
 * hydration never reads a count off the network.
 */
export async function fetchClipUpvoteState(
  uid: string,
  clips: ReadonlyArray<ClipForUpvoteHydration>,
): Promise<Map<string, ClipUpvoteState>> {
  const full = await fetchClipVoteState(
    uid,
    clips.map((c) => ({ ...c, downvoteCount: 0 })),
  );

  const result = new Map<string, ClipUpvoteState>();
  for (const [clipId, state] of full) {
    result.set(clipId, { count: state.upvoteCount, alreadyUpvoted: state.myVote === 1 });
  }
  return result;
}

/**
 * Record an upvote and return the resulting upvote count.
 *
 * Throws `AlreadyUpvotedError` when the caller already holds an upvote, and
 * `SelfUpvoteError` on their own clip. A caller who currently holds a
 * DOWNVOTE flips to an upvote rather than erroring — that is the correct
 * behaviour under the new model, and unreachable from the legacy UI, which
 * has no way to cast a downvote in the first place.
 */
export async function upvoteClip(uid: string, clipId: string): Promise<number> {
  const state: ClipVoteState = await castClipVote(uid, clipId, 1);
  return state.upvoteCount;
}

/** Withdraw the caller's upvote and return the resulting upvote count. */
export async function removeUpvote(uid: string, clipId: string): Promise<number> {
  const state: ClipVoteState = await removeClipVote(uid, clipId);
  return state.upvoteCount;
}
