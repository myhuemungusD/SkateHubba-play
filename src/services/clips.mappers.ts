/**
 * Types, references, and DTO mapping for the clips service.
 *
 * Lives next to the other clips.* split modules; consumers should import
 * the public surface from `./clips` (the barrel), not this file directly.
 */

import { collection, Timestamp, type DocumentSnapshot } from "firebase/firestore";
import { requireDb } from "../firebase";
import type { Clip, ClipModerationStatus, ClipRole, ClipSource } from "../types/clip";

/* ────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────── */

export type { Clip, ClipComment, ClipModerationStatus, ClipRole, ClipSource, GameClip, UserClip } from "../types/clip";

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

/**
 * Non-negative integer read with a 0 default.
 *
 * Legacy clips predate both vote aggregates; a missing, negative or
 * non-numeric value reads as 0 — the same default the firestore rules apply
 * via `get('upvoteCount', 0)`, so the mapper and the rule never disagree
 * about what a pre-backfill clip's count is.
 */
function toCountOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Map a clip snapshot to the `Clip` union.
 *
 * Two shapes are accepted, discriminated by `source`:
 *
 *   • `source: 'game'` (or missing — every clip written before user uploads
 *     existed was game-sourced) requires the full game coordinate set. A
 *     game clip missing `gameId` / `turnNumber` / `role` is genuinely
 *     malformed and still THROWS: the feed can't render it and, worse,
 *     silently coercing it to a user clip would hide a real write-path bug.
 *
 *   • `source: 'user'` carries `gameId`/`turnNumber`/`role` as explicit
 *     `null`s and skips those checks entirely.
 */
export function toClipDoc(snap: DocumentSnapshot): ClipDoc {
  const raw = snap.data() as Record<string, unknown> | undefined;
  if (!raw) throw new Error(`Malformed clip document: ${snap.id}`);

  // Missing `source` means a pre-feature doc, all of which were game clips.
  const source: ClipSource = raw.source === "user" ? "user" : "game";

  if (
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

  // Pre-aggregate clips lack these fields; default to 0 until the backfill
  // (scripts/backfill-clip-upvote-count.mjs) runs. `downvoteCount` has no
  // backfill at all — it is simply absent on every clip written before
  // downvoting shipped, and 0 is the correct reading of that absence.
  const common = {
    id: snap.id,
    playerUid: raw.playerUid,
    playerUsername: raw.playerUsername,
    trickName: raw.trickName,
    videoUrl: raw.videoUrl,
    spotId: typeof raw.spotId === "string" ? raw.spotId : null,
    createdAt,
    moderationStatus,
    upvoteCount: toCountOrZero(raw.upvoteCount),
    downvoteCount: toCountOrZero(raw.downvoteCount),
  };

  if (source === "user") {
    return { ...common, source: "user", gameId: null, turnNumber: null, role: null };
  }

  const role = raw.role;
  if (role !== "set" && role !== "match") {
    throw new Error(`Malformed clip document (role): ${snap.id}`);
  }
  if (typeof raw.gameId !== "string" || typeof raw.turnNumber !== "number") {
    throw new Error(`Malformed clip document (fields): ${snap.id}`);
  }

  return { ...common, source: "game", gameId: raw.gameId, turnNumber: raw.turnNumber, role };
}
