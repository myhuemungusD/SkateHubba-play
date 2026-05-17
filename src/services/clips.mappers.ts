/**
 * Types, references, and DTO mapping for the clips service.
 *
 * Lives next to the other clips.* split modules; consumers should import
 * the public surface from `./clips` (the barrel), not this file directly.
 */

import { collection, Timestamp, type DocumentSnapshot } from "firebase/firestore";
import { requireDb } from "../firebase";
import type { Clip, ClipModerationStatus, ClipRole } from "../types/clip";

/* ────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────── */

export type { Clip, ClipModerationStatus, ClipRole } from "../types/clip";

/** Persisted clip document — alias retained for callers that already import this name. */
export type ClipDoc = Clip;

/**
 * Sort modes for `fetchClipsFeed`.
 *
 *  • 'top' — orders by `upvoteCount` desc with `createdAt` desc as a natural
 *            tiebreak (so a zero-upvotes collection still falls through to
 *            most-recent-first without a code branch).
 *  • 'new' — legacy `createdAt` desc ordering, preserved for the toggle.
 */
export type ClipsFeedSort = "top" | "new";

/**
 * Opaque cursor returned by `fetchClipsFeed`. Callers round-trip it verbatim
 * to fetch the next page. Includes both the creation time and the doc id so
 * pagination stays stable when multiple clips share a server timestamp
 * (which happens on every landed turn: set + match are written atomically).
 *
 * `upvoteCount` is populated only when the page was fetched with sort='top'
 * — Firestore's `startAfter` must align lengthwise with the orderBy chain,
 * so the field is required for top-sort pagination but ignored for new-sort.
 */
export interface ClipsFeedCursor {
  createdAt: Timestamp;
  id: string;
  upvoteCount?: number;
}

export interface ClipsFeedPage {
  clips: ClipDoc[];
  /** Pass to the next `fetchClipsFeed` call. `null` when no more clips. */
  cursor: ClipsFeedCursor | null;
}

/** Shape required to enqueue a landed-turn clip pair on a transaction. */
export interface LandedClipContext {
  gameId: string;
  turnNumber: number;
  trickName: string;
  setterUid: string;
  setterUsername: string;
  matcherUid: string;
  matcherUsername: string;
  setVideoUrl: string | null;
  matchVideoUrl: string | null;
  /** True when the matcher's attempt was landed. Gates the `match` clip. */
  matcherLanded: boolean;
  spotId: string | null;
}

/* ────────────────────────────────────────────
 * References
 * ──────────────────────────────────────────── */

export function clipsRef() {
  return collection(requireDb(), "clips");
}

export function clipId(gameId: string, turnNumber: number, role: ClipRole): string {
  return `${gameId}_${turnNumber}_${role}`;
}

export function clipVotesRef() {
  return collection(requireDb(), "clipVotes");
}

/** Deterministic clipVote doc id — the source of the uniqueness guarantee. */
export function clipVoteId(uid: string, clipId: string): string {
  return `${uid}_${clipId}`;
}

/* ────────────────────────────────────────────
 * Doc mapping
 * ──────────────────────────────────────────── */

export function toClipDoc(snap: DocumentSnapshot): ClipDoc {
  const raw = snap.data() as Record<string, unknown> | undefined;
  if (!raw) throw new Error(`Malformed clip document: ${snap.id}`);

  const role = raw.role;
  if (role !== "set" && role !== "match") {
    throw new Error(`Malformed clip document (role): ${snap.id}`);
  }
  if (
    typeof raw.gameId !== "string" ||
    typeof raw.turnNumber !== "number" ||
    typeof raw.playerUid !== "string" ||
    typeof raw.playerUsername !== "string" ||
    typeof raw.trickName !== "string" ||
    typeof raw.videoUrl !== "string"
  ) {
    throw new Error(`Malformed clip document (fields): ${snap.id}`);
  }

  const createdAtRaw = raw.createdAt;
  const createdAt =
    createdAtRaw instanceof Timestamp
      ? createdAtRaw
      : createdAtRaw && typeof (createdAtRaw as { toMillis?: unknown }).toMillis === "function"
        ? (createdAtRaw as Timestamp)
        : null;

  // Older docs (pre-moderation-hardening) lack the field. Treat missing as
  // `active` so existing clips remain visible; any hidden-by-moderation clip
  // is already excluded upstream by the feed query's where() filter.
  const moderationStatus: ClipModerationStatus = raw.moderationStatus === "hidden" ? "hidden" : "active";

  // Pre-aggregate clips lack the field; default to 0 until the backfill
  // (scripts/backfill-clip-upvote-count.mjs) runs.
  const upvoteCount = typeof raw.upvoteCount === "number" && raw.upvoteCount >= 0 ? raw.upvoteCount : 0;

  return {
    id: snap.id,
    gameId: raw.gameId,
    turnNumber: raw.turnNumber,
    role,
    playerUid: raw.playerUid,
    playerUsername: raw.playerUsername,
    trickName: raw.trickName,
    videoUrl: raw.videoUrl,
    spotId: typeof raw.spotId === "string" ? raw.spotId : null,
    createdAt,
    moderationStatus,
    upvoteCount,
  };
}
