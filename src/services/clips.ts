/**
 * Landed-trick clips feed.
 *
 * Denormalized projection of `games.turnHistory` into a top-level `clips`
 * collection so the app can query a cross-game, reverse-chronological feed
 * without violating the per-game participant-only read rule. Each landed
 * turn can produce up to two clips:
 *   • `set`   — the setter's landed set trick (always landed by construction:
 *               failed sets never enter turnHistory)
 *   • `match` — the matcher's landed match attempt (only when they actually
 *               landed it; missed attempts are not feed content)
 *
 * Writes are issued from inside the same `runTransaction` in `games.*` that
 * appends the `TurnRecord`, so a clip doc exists iff the turn it references
 * exists. Clip IDs are deterministic (`${gameId}_${turnNumber}_${role}`) to
 * make the writes idempotent across transaction retries.
 *
 * Rules in `firestore.rules` gate:
 *   • read   — any signed-in user
 *   • create — only game participants, verified via `get()` on the game doc
 *   • update/delete — forbidden (clips are immutable once written)
 *
 * Implementation is split across per-concern modules to stay under the
 * 400-LOC services budget. This file is the public surface — all callers
 * import from `./clips`:
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
