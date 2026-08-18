/**
 * Types, references, and DTO mapping for the community-dispute service.
 *
 * Lives next to the other disputes.* split modules; consumers should import
 * the public surface from `./disputes` (the barrel), not this file directly.
 * Mirrors the arrangement of `clips.mappers.ts`.
 */

import {
  collection,
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type DocumentSnapshot,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import type { Dispute, DisputeModerationStatus, DisputeOutcome, DisputeStatus } from "../types/dispute";

/* ────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────── */

export type {
  Dispute,
  DisputeModerationStatus,
  DisputeOutcome,
  DisputeStatus,
  DisputeTally,
  DisputeVerdict,
  DisputeViewerState,
  DisputeVote,
} from "../types/dispute";

/* ────────────────────────────────────────────
 * References
 * ──────────────────────────────────────────── */

export function disputesRef(): CollectionReference<DocumentData> {
  return collection(requireDb(), "disputes");
}

export function disputeVotesRef(): CollectionReference<DocumentData> {
  return collection(requireDb(), "disputeVotes");
}

/**
 * Deterministic dispute doc id. A turn can only ever be disputed once, and
 * the create stays idempotent under transaction retry.
 */
export function disputeId(gameId: string, turnNumber: number): string {
  return `${gameId}_${turnNumber}`;
}

/** Deterministic disputeVote doc id — the source of the one-vote guarantee. */
export function disputeVoteId(uid: string, disputeId: string): string {
  return `${uid}_${disputeId}`;
}

/* ────────────────────────────────────────────
 * Doc mapping
 * ──────────────────────────────────────────── */

/**
 * Coerce a persisted vote aggregate into a safe non-negative number.
 *
 * Legacy-safe in the same way `clips.upvoteCount` is: a doc written before
 * the field existed (or corrupted out-of-band via Admin SDK) reads as 0
 * rather than surfacing `undefined`/`NaN` into the tally arithmetic. Shared
 * by the mapper (read path) and `castDisputeVerdict` (write path) so the
 * literal we write always matches what the rule and the UI compute.
 */
export function coerceVoteCount(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

/**
 * Narrow a persisted `verdict` to the referee's union. Anything unexpected —
 * missing (dispute still open), a legacy literal, or a corrupted value — reads
 * as undefined so consumers only ever see a ruling they can render.
 */
export function coerceVerdict(raw: unknown): DisputeOutcome | undefined {
  return raw === "land" || raw === "bail" || raw === "tie" || raw === "none" ? raw : undefined;
}

export function toDisputeDoc(snap: DocumentSnapshot): Dispute {
  const raw = snap.data() as Record<string, unknown> | undefined;
  if (!raw) throw new Error(`Malformed dispute document: ${snap.id}`);

  if (
    typeof raw.gameId !== "string" ||
    typeof raw.turnNumber !== "number" ||
    typeof raw.trickName !== "string" ||
    typeof raw.setterUid !== "string" ||
    typeof raw.setterUsername !== "string" ||
    typeof raw.matcherUid !== "string" ||
    typeof raw.matcherUsername !== "string" ||
    // matchVideoUrl is the clip the feed plays — a dispute without one is
    // unjudgeable, so it is required rather than nullable.
    typeof raw.matchVideoUrl !== "string"
  ) {
    throw new Error(`Malformed dispute document (fields): ${snap.id}`);
  }

  const createdAtRaw = raw.createdAt;
  const createdAt =
    createdAtRaw instanceof Timestamp
      ? createdAtRaw
      : createdAtRaw && typeof (createdAtRaw as { toMillis?: unknown }).toMillis === "function"
        ? (createdAtRaw as Timestamp)
        : null;

  // Unknown/missing status reads as 'open' so a doc written before a future
  // status value existed still renders; the feed query already filters
  // server-side, so this only affects direct reads.
  const status: DisputeStatus = raw.status === "closed" ? "closed" : "open";
  const moderationStatus: DisputeModerationStatus = raw.moderationStatus === "hidden" ? "hidden" : "active";

  const verdict = coerceVerdict(raw.verdict);

  return {
    id: snap.id,
    gameId: raw.gameId,
    turnNumber: raw.turnNumber,
    trickName: raw.trickName,
    setterUid: raw.setterUid,
    setterUsername: raw.setterUsername,
    matcherUid: raw.matcherUid,
    matcherUsername: raw.matcherUsername,
    setVideoUrl: typeof raw.setVideoUrl === "string" ? raw.setVideoUrl : null,
    matchVideoUrl: raw.matchVideoUrl,
    spotId: typeof raw.spotId === "string" ? raw.spotId : null,
    createdAt,
    status,
    moderationStatus,
    landVotes: coerceVoteCount(raw.landVotes),
    bailVotes: coerceVoteCount(raw.bailVotes),
    // Omit rather than set undefined so the object shape matches a doc that
    // never carried the field (exactOptionalPropertyTypes-friendly).
    ...(verdict === undefined ? {} : { verdict }),
  };
}
