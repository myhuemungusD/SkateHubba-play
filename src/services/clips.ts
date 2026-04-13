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
 * Writes are issued from inside the same `runTransaction` in `games.ts` that
 * appends the `TurnRecord`, so a clip doc exists iff the turn it references
 * exists. Clip IDs are deterministic (`${gameId}_${turnNumber}_${role}`) to
 * make the writes idempotent across transaction retries.
 *
 * Rules in `firestore.rules` gate:
 *   • read   — any signed-in user
 *   • create — only game participants, verified via `get()` on the game doc
 *   • update/delete — forbidden (clips are immutable once written)
 */

import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDocs,
  limit as limitFn,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  Timestamp,
  where,
  type DocumentSnapshot,
  type FieldValue,
  type QueryConstraint,
  type Transaction,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";

/* ────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────── */

export type ClipRole = "set" | "match";

/**
 * Client-writable moderation state. Clients can only ever create clips with
 * `active` status; transitions to `hidden` happen server-side (Admin SDK,
 * via a trust-and-safety tooling path outside this repo) when a clip is
 * taken down in response to a user report. App Store Guideline 1.2
 * compliance requires the feed to never surface hidden clips, so the
 * feed query filters `moderationStatus == 'active'` explicitly.
 */
export type ClipModerationStatus = "active" | "hidden";

export interface ClipDoc {
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
}

/**
 * Opaque cursor returned by `fetchClipsFeed`. Callers round-trip it verbatim
 * to fetch the next page. Includes both the creation time and the doc id so
 * pagination stays stable when multiple clips share a server timestamp
 * (which happens on every landed turn: set + match are written atomically).
 */
export interface ClipsFeedCursor {
  createdAt: Timestamp;
  id: string;
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

function clipsRef() {
  return collection(requireDb(), "clips");
}

function clipId(gameId: string, turnNumber: number, role: ClipRole): string {
  return `${gameId}_${turnNumber}_${role}`;
}

/* ────────────────────────────────────────────
 * Transactional writes (called from games.ts)
 * ──────────────────────────────────────────── */

interface ClipWritePayload {
  gameId: string;
  turnNumber: number;
  role: ClipRole;
  playerUid: string;
  playerUsername: string;
  trickName: string;
  videoUrl: string;
  spotId: string | null;
  createdAt: FieldValue;
  moderationStatus: ClipModerationStatus;
}

function buildClipPayload(ctx: Omit<ClipWritePayload, "createdAt">, createdAt: FieldValue): ClipWritePayload {
  return { ...ctx, createdAt };
}

/**
 * Queue 0–2 clip doc writes on an in-flight game transaction.
 *
 * The `set` clip is written whenever the setter recorded a video (their set
 * was landed by construction — `failSetTrick` never appends to turnHistory).
 * The `match` clip is written only when the matcher actually landed and a
 * video was recorded; missed attempts aren't feed content.
 */
export function writeLandedClipsInTransaction(tx: Transaction, ctx: LandedClipContext): void {
  const db = requireDb();
  const createdAt = serverTimestamp();

  if (ctx.setVideoUrl) {
    const setRef = doc(db, "clips", clipId(ctx.gameId, ctx.turnNumber, "set"));
    tx.set(
      setRef,
      buildClipPayload(
        {
          gameId: ctx.gameId,
          turnNumber: ctx.turnNumber,
          role: "set",
          playerUid: ctx.setterUid,
          playerUsername: ctx.setterUsername,
          trickName: ctx.trickName,
          videoUrl: ctx.setVideoUrl,
          spotId: ctx.spotId,
          moderationStatus: "active",
        },
        createdAt,
      ),
    );
  }

  if (ctx.matcherLanded && ctx.matchVideoUrl) {
    const matchRef = doc(db, "clips", clipId(ctx.gameId, ctx.turnNumber, "match"));
    tx.set(
      matchRef,
      buildClipPayload(
        {
          gameId: ctx.gameId,
          turnNumber: ctx.turnNumber,
          role: "match",
          playerUid: ctx.matcherUid,
          playerUsername: ctx.matcherUsername,
          trickName: ctx.trickName,
          videoUrl: ctx.matchVideoUrl,
          spotId: ctx.spotId,
          moderationStatus: "active",
        },
        createdAt,
      ),
    );
  }
}

/* ────────────────────────────────────────────
 * Feed query
 * ──────────────────────────────────────────── */

function toClipDoc(snap: DocumentSnapshot): ClipDoc {
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
  };
}

/**
 * Fetch one page of the landed-trick feed, newest first.
 *
 * Pagination uses both `createdAt` and the doc id as an explicit tiebreaker
 * so two clips written in the same transaction (same `createdAt`) don't
 * cause a skipped or duplicated row at page boundaries.
 */
export async function fetchClipsFeed(cursor: ClipsFeedCursor | null = null, pageSize = 20): Promise<ClipsFeedPage> {
  const boundedSize = Math.max(1, Math.min(50, pageSize));

  // App Store Guideline 1.2 requires offensive UGC to be removable from
  // the feed. Hidden clips (moderationStatus === 'hidden') are filtered
  // out server-side. Paired with the (moderationStatus, createdAt desc,
  // __name__ desc) composite index in firestore.indexes.json.
  const constraints: QueryConstraint[] = [
    where("moderationStatus", "==", "active"),
    orderBy("createdAt", "desc"),
    orderBy(documentId(), "desc"),
  ];
  if (cursor) {
    constraints.push(startAfter(cursor.createdAt, cursor.id));
  }
  constraints.push(limitFn(boundedSize));

  const q = query(clipsRef(), ...constraints);
  const snap = await withRetry(() => getDocs(q));
  const clips = snap.docs.map((d) => toClipDoc(d));

  const last = clips[clips.length - 1];
  const nextCursor: ClipsFeedCursor | null = last && last.createdAt ? { createdAt: last.createdAt, id: last.id } : null;

  return { clips, cursor: nextCursor };
}

/* ────────────────────────────────────────────
 * Account-deletion cascade
 * ──────────────────────────────────────────── */

/**
 * Delete every clip owned by `uid`. Invoked from `deleteUserData` when a
 * user removes their account — closes the GDPR/CCPA "right to erasure"
 * loop so clips don't outlive the account that produced them.
 *
 * Best-effort: logs and swallows per-doc delete failures so a partial
 * cascade never blocks the larger account-deletion flow. The owner-only
 * delete rule in firestore.rules means this caller must be authenticated
 * AS `uid` — servicing another user's deletion requires Admin SDK.
 */
export async function deleteUserClips(uid: string): Promise<void> {
  const db = requireDb();
  let snap;
  try {
    snap = await withRetry(() => getDocs(query(clipsRef(), where("playerUid", "==", uid))));
  } catch (err) {
    logger.warn("clips_delete_query_failed", { uid, error: parseFirebaseError(err) });
    return;
  }

  const results = await Promise.allSettled(snap.docs.map((d) => deleteDoc(doc(db, "clips", d.id))));

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    logger.warn("clips_delete_partial", { uid, total: results.length, failed });
  }
}
