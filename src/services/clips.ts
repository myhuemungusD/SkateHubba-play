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

export type {
  Clip,
  ClipComment,
  ClipModerationStatus,
  ClipRole,
  ClipSource,
  ClipDoc,
  ClipsFeedSort,
  ClipsFeedCursor,
  ClipsFeedPage,
  GameClip,
  LandedClipContext,
  UserClip,
} from "./clips.mappers";

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
export type { ClipUpvoteState, ClipForUpvoteHydration } from "./clips.upvotes";

export {
  AlreadyVotedError,
  NotVotedError,
  SelfVoteError,
  castClipVote,
  castClipVote as voteClip,
  fetchClipVoteState,
  removeClipVote,
} from "./clips.votes";
export type { ClipVoteState, ClipVoteValue, ClipForVoteHydration } from "./clips.votes";

export {
  ClipCooldownError,
  USER_CLIP_COOLDOWN_MS,
  UserBannedError,
  createUserClip,
  newUserClipId,
} from "./clips.userWrites";
export type { CreateUserClipParams } from "./clips.userWrites";

export {
  CLIP_COMMENT_MAX_LENGTH,
  CLIP_COMMENT_MIN_LENGTH,
  createClipComment,
  deleteClipComment,
  fetchClipComments,
} from "./clips.comments";
export type { ClipCommentsCursor, ClipCommentsPage } from "./clips.comments";

export { deleteClipComments, deleteUserClips, deleteUserClipVotes } from "./clips.cascade";
