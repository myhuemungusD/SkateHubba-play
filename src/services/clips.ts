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
  getCountFromServer,
  getDoc,
  getDocs,
  limit as limitFn,
  orderBy,
  query,
  runTransaction,
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

  // Per-doc try/catch so one malformed clip can't blank the entire page.
  // Cursor advancement still uses the last *raw* doc so pagination doesn't
  // stall on a window that happens to contain an unparseable trailing row.
  const clips: ClipDoc[] = [];
  for (const d of snap.docs) {
    try {
      clips.push(toClipDoc(d));
    } catch (err) {
      logger.warn("clips_feed_doc_malformed", { docId: d.id, error: parseFirebaseError(err) });
    }
  }

  const lastRaw = snap.docs[snap.docs.length - 1];
  const lastRawCreatedAt = lastRaw ? (lastRaw.data() as { createdAt?: unknown } | undefined)?.createdAt : undefined;
  const nextCursor: ClipsFeedCursor | null =
    lastRaw && lastRawCreatedAt instanceof Timestamp
      ? { createdAt: lastRawCreatedAt, id: lastRaw.id }
      : (() => {
          const last = clips[clips.length - 1];
          return last && last.createdAt ? { createdAt: last.createdAt, id: last.id } : null;
        })();

  return { clips, cursor: nextCursor };
}

/**
 * Fetch a random sample of recent active landed-trick clips for the lobby
 * spotlight.
 *
 * Client-side shuffle of the most-recent N clips. Gives the lobby feed variety
 * without an expensive cross-collection random query, and still favors fresh
 * content because the pool is recent-first.
 */
export async function fetchRandomLandedClips(sampleSize = 12, poolSize = 60): Promise<ClipDoc[]> {
  const boundedSample = Math.max(1, Math.min(50, sampleSize));
  const boundedPool = Math.max(boundedSample, Math.min(200, poolSize));

  const q = query(
    clipsRef(),
    where("moderationStatus", "==", "active"),
    orderBy("createdAt", "desc"),
    orderBy(documentId(), "desc"),
    limitFn(boundedPool),
  );

  const snap = await withRetry(() => getDocs(q));

  const clips: ClipDoc[] = [];
  for (const d of snap.docs) {
    try {
      clips.push(toClipDoc(d));
    } catch (err) {
      logger.warn("clips_random_doc_malformed", { docId: d.id, error: parseFirebaseError(err) });
    }
  }

  // Fisher-Yates shuffle.
  for (let i = clips.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clips[i], clips[j]] = [clips[j], clips[i]];
  }

  return clips.slice(0, Math.min(boundedSample, clips.length));
}

/* ────────────────────────────────────────────
 * Upvotes
 * ──────────────────────────────────────────── */

/**
 * Thrown by `upvoteClip` when the caller has already upvoted the target
 * clip. Spec: single-tap upvote, no undo — the UI converts this into the
 * "already filled" state without surfacing an error toast.
 */
export class AlreadyUpvotedError extends Error {
  constructor(public readonly clipId: string) {
    super(`already_upvoted:${clipId}`);
    this.name = "AlreadyUpvotedError";
  }
}

function clipVotesRef() {
  return collection(requireDb(), "clipVotes");
}

/** Deterministic clipVote doc id — the source of the uniqueness guarantee. */
function clipVoteId(uid: string, clipId: string): string {
  return `${uid}_${clipId}`;
}

async function countClipUpvotes(clipId: string): Promise<number> {
  try {
    const q = query(clipVotesRef(), where("clipId", "==", clipId));
    const snap = await withRetry(() => getCountFromServer(q));
    return snap.data().count;
  } catch (err) {
    logger.warn("clip_upvote_count_failed", { clipId, error: parseFirebaseError(err) });
    return 0;
  }
}

async function hasUserUpvoted(uid: string, clipId: string): Promise<boolean> {
  try {
    const snap = await withRetry(() => getDoc(doc(requireDb(), "clipVotes", clipVoteId(uid, clipId))));
    return snap.exists();
  } catch (err) {
    logger.warn("clip_upvote_check_failed", { clipId, error: parseFirebaseError(err) });
    return false;
  }
}

/** Per-clip upvote state for the lobby feed: live count + whether the
 *  current viewer has already upvoted (controls the filled/disabled UI). */
export interface ClipUpvoteState {
  count: number;
  alreadyUpvoted: boolean;
}

/**
 * Batch-fetch upvote state for a page of clips.
 *
 * Fires `2 * clipIds.length` Firestore reads in parallel — one aggregate
 * count + one vote-doc existence check per clip. At a feed PAGE_SIZE of 12
 * that's 24 small reads, well under the per-page budget. Per-clip failures
 * are swallowed and default to `{ count: 0, alreadyUpvoted: false }` so the
 * feed can render even when the aggregate index is unavailable or App Check
 * blocks a single read.
 *
 * Returns a Map keyed by clipId so callers can look up state by id without
 * a linear scan. Missing entries (e.g. caller passed an empty array) simply
 * won't appear in the Map; callers should treat absence as `{0,false}`.
 */
export async function fetchClipUpvoteState(
  uid: string,
  clipIds: ReadonlyArray<string>,
): Promise<Map<string, ClipUpvoteState>> {
  const result = new Map<string, ClipUpvoteState>();
  if (clipIds.length === 0) return result;

  // countClipUpvotes and hasUserUpvoted both swallow errors and return
  // safe defaults (0 / false), so this Promise.all never rejects in
  // practice — a per-id failure leaves that clip's entry at {0,false}
  // without taking down the whole batch.
  const settled = await Promise.all(
    clipIds.map(async (id): Promise<readonly [string, ClipUpvoteState]> => {
      const [count, alreadyUpvoted] = await Promise.all([countClipUpvotes(id), hasUserUpvoted(uid, id)]);
      return [id, { count, alreadyUpvoted }] as const;
    }),
  );

  for (const [id, state] of settled) result.set(id, state);
  return result;
}

/**
 * Record a single upvote on a clip and return the resulting count.
 *
 * Uniqueness is enforced by the deterministic `{uid}_{clipId}` doc id: the
 * transaction reads the doc and throws `AlreadyUpvotedError` when it already
 * exists. The `clipVotes` rule additionally enforces this via
 * `allow update/delete: if false` so a rule-only client can't double-vote
 * by setDoc-ing over the existing entry.
 */
export async function upvoteClip(uid: string, clipId: string): Promise<number> {
  const db = requireDb();
  const voteRef = doc(db, "clipVotes", clipVoteId(uid, clipId));

  try {
    await runTransaction(db, async (tx) => {
      const existing = await tx.get(voteRef);
      if (existing.exists()) throw new AlreadyUpvotedError(clipId);
      tx.set(voteRef, {
        uid,
        clipId,
        createdAt: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof AlreadyUpvotedError) throw err;
    // permission-denied here means the security rules blocked a clean
    // create — most likely because the vote doc already exists and the
    // `allow update: if false` rule rejected an implicit overwrite
    // (e.g. emulator without runTransaction instrumentation). Surface it
    // as the same business-level error rather than a raw permission
    // failure so callers have a single error to handle.
    const code = (err as { code?: string }).code;
    if (code === "permission-denied") throw new AlreadyUpvotedError(clipId);
    throw err;
  }

  return countClipUpvotes(clipId);
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
