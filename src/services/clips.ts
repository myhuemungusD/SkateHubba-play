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
  doc,
  documentId,
  getDocs,
  limit as limitFn,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  Timestamp,
  type DocumentSnapshot,
  type FieldValue,
  type QueryConstraint,
  type Transaction,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";

/* ────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────── */

export type ClipRole = "set" | "match";

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

  const constraints: QueryConstraint[] = [orderBy("createdAt", "desc"), orderBy(documentId(), "desc")];
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
