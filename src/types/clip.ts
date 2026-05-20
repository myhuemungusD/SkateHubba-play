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
 * Client-writable moderation state. Clients only ever create clips with
 * `active`; transitions to `hidden` happen server-side (Admin SDK) when a
 * clip is taken down in response to a user report.
 */
export type ClipModerationStatus = "active" | "hidden";

/**
 * Persisted clip document shape.
 *
 * `upvoteCount` is a server-maintained aggregate of the matching
 * `clipVotes` subset for this clip. Writes are gated by Firestore rules to
 * deltas of ±1 paired with the corresponding vote-doc create/delete, so
 * the field is safe to read directly for ranking without a fan-out count
 * query. Legacy clips that predate the field default to `0` at the
 * service mapper boundary.
 */
export interface Clip {
  id: string;
  gameId: string;
  turnNumber: number;
  role: ClipRole;
  playerUid: string;
  playerUsername: string;
  trickName: string;
  videoUrl: string;
  spotId: string | null;
  createdAt: Timestamp | null;
  moderationStatus: ClipModerationStatus;
  upvoteCount: number;
}
