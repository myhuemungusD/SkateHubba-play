/**
 * Barrel re-export for the clips service. Implementation lives in:
 *   - clips.mappers.ts  — types, refs, DTO mapping
 *   - clips.writes.ts   — transactional landed-clip writes (called from games.*)
 *   - clips.feed.ts     — feed query + 'top' index circuit breaker
 *   - clips.votes.ts     — up/down vote writes + per-page hydration
 *   - clips.upvotes.ts   — legacy upvote-only projection of clips.votes
 *   - clips.userWrites.ts — user-posted clip creation
 *   - clips.comments.ts  — clip comment CRUD + pagination
 *   - clips.cascade.ts   — account-deletion cascade
 */

export type { ClipDoc, ClipsFeedSort, ClipsFeedCursor, LandedClipContext } from "./clips.mappers";

export { writeLandedClipsInTransaction } from "./clips.writes";

export { fetchClipsFeed, _resetTopIndexCircuitBreaker } from "./clips.feed";

export {
  AlreadyUpvotedError,
  NotUpvotedError,
  SelfUpvoteError,
  fetchClipUpvoteState,
  removeUpvote,
  upvoteClip,
} from "./clips.upvotes";

export { deleteClipComments, deleteUserClips, deleteUserClipVotes } from "./clips.cascade";
