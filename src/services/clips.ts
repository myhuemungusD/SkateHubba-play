/**
 * Barrel re-export for the clips service. Implementation lives in:
 *   - clips.mappers.ts  — types, refs, DTO mapping
 *   - clips.writes.ts   — transactional landed-clip writes (called from games.*)
 *   - clips.feed.ts     — feed query + 'top' index circuit breaker
 *   - clips.upvotes.ts  — upvote write + per-page hydration
 *   - clips.cascade.ts  — account-deletion cascade
 */

export type {
  Clip,
  ClipModerationStatus,
  ClipRole,
  ClipDoc,
  ClipsFeedSort,
  ClipsFeedCursor,
  ClipsFeedPage,
  LandedClipContext,
} from "./clips.mappers";

export { writeLandedClipsInTransaction } from "./clips.writes";

export { fetchClipsFeed, _resetTopIndexCircuitBreaker } from "./clips.feed";

export { AlreadyUpvotedError, fetchClipUpvoteState, upvoteClip } from "./clips.upvotes";
export type { ClipUpvoteState, ClipForUpvoteHydration } from "./clips.upvotes";

export { deleteUserClips } from "./clips.cascade";
