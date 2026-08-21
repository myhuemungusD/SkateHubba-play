/**
 * Comments on clips — `clips/{clipId}/comments/{commentId}`.
 *
 * A subcollection rather than a top-level collection because a comment has
 * no meaning apart from its clip, and the path lets the rules authorize a
 * write against the parent clip without a `get()` on another collection.
 *
 * The trade-off is that Firestore does NOT cascade a parent delete: removing
 * a clip leaves its comments behind as orphans reachable only by path. The
 * account-deletion cascade in `clips.cascade.ts` therefore sweeps them
 * explicitly — see the limits documented there.
 *
 * Author identity is denormalized onto each comment (`userId` + `username`)
 * so a thread renders without a per-author profile read. A later username
 * change does not rewrite old comments; that is the same accepted staleness
 * as `Clip.playerUsername`.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit as limitFn,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  Timestamp,
  type CollectionReference,
  type DocumentSnapshot,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import type { ClipComment } from "../types/clip";

export type { ClipComment } from "../types/clip";

/**
 * Comment length bounds, mirrored from the create rule. The lower bound is
 * applied AFTER trimming so a comment of pure whitespace is rejected here
 * rather than landing as a blank row in the thread.
 */
export const CLIP_COMMENT_MIN_LENGTH = 1;
export const CLIP_COMMENT_MAX_LENGTH = 300;

/** Default and maximum page sizes for {@link fetchClipComments}. */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Opaque cursor for comment pagination. Carries the doc id alongside the
 * timestamp because comments posted in the same second are common in a live
 * thread, and a timestamp-only cursor would skip or duplicate rows at the
 * page boundary — the same reasoning as `ClipsFeedCursor`.
 */
export interface ClipCommentsCursor {
  createdAt: Timestamp;
  id: string;
}

export interface ClipCommentsPage {
  comments: ClipComment[];
  /** Pass to the next `fetchClipComments` call. `null` when no more comments. */
  cursor: ClipCommentsCursor | null;
}

/**
 * A path segment that is empty or contains "/" would silently retarget the
 * write at a different document. Same guard as `admin.ts` → `isValidUid`.
 */
function requireId(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0 || value.includes("/")) {
    throw new Error(`Invalid ${label}.`);
  }
}

export function clipCommentsRef(clipId: string): CollectionReference {
  return collection(requireDb(), "clips", clipId, "comments");
}

/** Structural Timestamp read — mirrors `toClipDoc`, tolerant of test doubles. */
function toTimestampOrNull(value: unknown): Timestamp | null {
  if (value instanceof Timestamp) return value;
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") return value as Timestamp;
  return null;
}

/** Map one comment snapshot. Throws on a doc the thread cannot render. */
export function toClipComment(clipId: string, snap: DocumentSnapshot): ClipComment {
  const raw = snap.data() as Record<string, unknown> | undefined;
  if (!raw) throw new Error(`Malformed clip comment: ${snap.id}`);
  if (typeof raw.userId !== "string" || typeof raw.text !== "string") {
    throw new Error(`Malformed clip comment (fields): ${snap.id}`);
  }
  return {
    id: snap.id,
    clipId,
    userId: raw.userId,
    // A missing username is survivable — the thread renders a placeholder —
    // whereas a missing author uid or body is not (no delete affordance, no
    // content), so only those two throw.
    username: typeof raw.username === "string" ? raw.username : "",
    text: raw.text,
    createdAt: toTimestampOrNull(raw.createdAt),
  };
}

/**
 * Post a comment on a clip and return it as it was written.
 *
 * `addDoc` (random id) because comments are not unique per author: one
 * skater can comment on the same clip repeatedly.
 *
 * Text is trimmed and hard-capped at {@link CLIP_COMMENT_MAX_LENGTH} before
 * the write. The rule enforces the same bounds — this is a fail-fast that
 * turns a silent `permission-denied` into a legible message, not the
 * authorization point.
 *
 * The returned comment carries `createdAt: null`: the field is a
 * `serverTimestamp()` sentinel that has no value until the server resolves
 * it, and reading it back would cost a round-trip to learn something the
 * thread doesn't render precisely anyway. Callers append it optimistically;
 * the real timestamp arrives on the next fetch.
 */
export async function createClipComment(
  userId: string,
  username: string,
  clipId: string,
  text: string,
): Promise<ClipComment> {
  requireId(clipId, "clip id");
  requireId(userId, "user id");

  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed.length < CLIP_COMMENT_MIN_LENGTH) throw new Error("Write something before posting.");
  if (trimmed.length > CLIP_COMMENT_MAX_LENGTH) {
    throw new Error(`Comments are limited to ${CLIP_COMMENT_MAX_LENGTH} characters.`);
  }
  const author = typeof username === "string" ? username : "";

  try {
    const ref = await addDoc(clipCommentsRef(clipId), {
      userId,
      username: author,
      text: trimmed,
      createdAt: serverTimestamp(),
    });
    return { id: ref.id, clipId, userId, username: author, text: trimmed, createdAt: null };
  } catch (err) {
    logger.warn("clip_comment_create_failed", { clipId, error: parseFirebaseError(err) });
    throw new Error("Failed to post comment. Please try again.");
  }
}

/**
 * Delete a comment. Author-only, enforced by the delete rule — this call
 * issues the write and lets the rule reject a caller who isn't the author.
 * Idempotent: deleting a missing doc is not an error.
 *
 * `userId` is the ACTING user. It is validated (an unusable value means the
 * caller is mis-wired) and logged, but authorship itself is not re-checked
 * here: verifying it client-side would need a read that the rule already
 * performs authoritatively on the server.
 */
export async function deleteClipComment(userId: string, clipId: string, commentId: string): Promise<void> {
  requireId(userId, "user id");
  requireId(clipId, "clip id");
  requireId(commentId, "comment id");

  try {
    await deleteDoc(doc(requireDb(), "clips", clipId, "comments", commentId));
  } catch (err) {
    logger.warn("clip_comment_delete_failed", { userId, clipId, commentId, error: parseFirebaseError(err) });
    throw err;
  }
}

/**
 * Fetch one page of a clip's comments, newest first.
 *
 * Ordered `createdAt desc, __name__ desc` — the doc-id tiebreaker keeps
 * pagination stable across comments that share a server timestamp. Both
 * orderings are covered by Firestore's automatic single-field indexes, so
 * no composite index deploy is required.
 *
 * A malformed comment is logged and skipped rather than failing the page:
 * one bad row must not blank a thread. Cursor advancement uses the last RAW
 * doc so pagination cannot stall on a window whose trailing row is the
 * unparseable one.
 */
export async function fetchClipComments(
  clipId: string,
  cursor: ClipCommentsCursor | null = null,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<ClipCommentsPage> {
  requireId(clipId, "clip id");
  const boundedSize = Math.max(1, Math.min(MAX_PAGE_SIZE, pageSize));

  const constraints = [orderBy("createdAt", "desc"), orderBy("__name__", "desc")];
  const q = cursor
    ? query(clipCommentsRef(clipId), ...constraints, startAfter(cursor.createdAt, cursor.id), limitFn(boundedSize))
    : query(clipCommentsRef(clipId), ...constraints, limitFn(boundedSize));

  const snap = await withRetry(() => getDocs(q));

  const comments: ClipComment[] = [];
  for (const d of snap.docs) {
    try {
      comments.push(toClipComment(clipId, d));
    } catch (err) {
      logger.warn("clip_comment_malformed", { clipId, docId: d.id, error: parseFirebaseError(err) });
    }
  }

  const lastRaw = snap.docs[snap.docs.length - 1];
  const lastCreatedAt = lastRaw ? toTimestampOrNull((lastRaw.data() as { createdAt?: unknown }).createdAt) : null;
  const nextCursor: ClipCommentsCursor | null =
    lastRaw && lastCreatedAt ? { createdAt: lastCreatedAt, id: lastRaw.id } : null;

  return { comments, cursor: nextCursor };
}
