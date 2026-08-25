/**
 * Shared types for the landed-trick clips feed.
 *
 * Lives here (rather than co-located with the service) so callers that only
 * need the shape — UI components, the upvoteCount backfill script, future
 * feature flags — can import the contract without dragging the Firebase SDK
 * surface in `src/services/clips.ts` along with it.
 */
import type { Timestamp } from "firebase/firestore";

export type ClipRole = "set" | "match";

/**
 * Where a clip came from.
 *
 *  • 'game' — written by `writeLandedClipsInTransaction` when a turn is
 *             landed. Carries the game coordinates (`gameId`, `turnNumber`,
 *             `role`) and lives at the deterministic
 *             `${gameId}_${turnNumber}_${role}` doc id.
 *  • 'user' — uploaded directly by a skater from the clips feed
 *             (`createUserClip`). Random doc id, no game coordinates.
 *
 * Legacy clips predate the field; the mapper defaults missing `source` to
 * `'game'` because every clip written before this feature was game-sourced.
 */
export type ClipSource = "game" | "user";

/**
 * Client-writable moderation state. Clients only ever create clips with
 * `active`; transitions to `hidden` happen server-side (Admin SDK) when a
 * clip is taken down in response to a user report.
 */
export type ClipModerationStatus = "active" | "hidden";

/**
 * Fields every clip carries regardless of where it came from.
 *
 * `upvoteCount` / `downvoteCount` are server-maintained aggregates of the
 * matching `clipVotes` subset for this clip. Writes are gated by Firestore
 * rules to deltas of ±1 paired with the corresponding vote-doc
 * create/delete, so the fields are safe to read directly for ranking
 * without a fan-out count query. Legacy clips that predate either field
 * default to `0` at the service mapper boundary.
 *
 * Ranking reads `upvoteCount` only — `downvoteCount` is display/moderation
 * signal, never a sort key, so a brigaded clip drops out of nobody's feed
 * on downvotes alone.
 */
interface ClipBase {
  id: string;
  playerUid: string;
  playerUsername: string;
  trickName: string;
  videoUrl: string;
  spotId: string | null;
  createdAt: Timestamp | null;
  moderationStatus: ClipModerationStatus;
  upvoteCount: number;
  downvoteCount: number;
}

/** A clip produced by a landed turn in a game of S.K.A.T.E. */
export interface GameClip extends ClipBase {
  source: "game";
  gameId: string;
  turnNumber: number;
  role: ClipRole;
}

/**
 * A clip a skater uploaded directly, outside of any game.
 *
 * The game coordinates are present-but-null rather than absent so callers
 * can read `clip.gameId` without first narrowing on `source` — the union
 * discriminates on `source`, and narrowing is only needed when a caller
 * actually requires the non-null game fields.
 */
export interface UserClip extends ClipBase {
  source: "user";
  gameId: null;
  turnNumber: null;
  role: null;
}

/** Persisted clip document shape — discriminated on `source`. */
export type Clip = GameClip | UserClip;

/**
 * A comment on a clip, stored at `clips/{clipId}/comments/{commentId}`.
 *
 * `username` is denormalized at write time (same convention as
 * `Clip.playerUsername`) so the feed can render a comment list without a
 * per-author profile read. UNTRUSTED user-authored text: render `text` as
 * plain text, never innerHTML.
 */
export interface ClipComment {
  id: string;
  /** Parent clip — denormalized from the path for callers that flatten lists. */
  clipId: string;
  userId: string;
  username: string;
  /** 1–300 chars, enforced client-side and by the create rule. */
  text: string;
  createdAt: Timestamp | null;
}
