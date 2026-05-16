/**
 * Feed query for the landed-trick clips feed.
 *
 * Session-scoped circuit breaker for the 'top' composite index keeps a
 * still-building (or undeployed) index from burning a failed read on
 * every lobby refresh.
 */

import {
  documentId,
  getDocs,
  limit as limitFn,
  orderBy,
  query,
  startAfter,
  Timestamp,
  where,
  type QueryConstraint,
} from "firebase/firestore";
import { withRetry } from "../utils/retry";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import {
  clipsRef,
  toClipDoc,
  type ClipDoc,
  type ClipsFeedCursor,
  type ClipsFeedPage,
  type ClipsFeedSort,
} from "./clips.mappers";

/**
 * Session-scoped circuit breaker for the 'top' composite index.
 *
 * The 'top' sort needs a 4-field composite index that may be still building
 * (or undeployed). Without this flag, every lobby refresh would burn a
 * failing Firestore read before the fallback kicks in. Once we've observed
 * one missing-index failure, route all subsequent 'top' requests directly
 * to the 'new' sort for the rest of the session — one read per load instead
 * of two. The flag resets on hard reload, so a freshly-built index is
 * picked up the next time the user opens the app.
 */
let topIndexUnavailable = false;

/** Test-only: reset the circuit breaker between cases. Not part of the
 *  public surface — exported solely for vitest. */
export function _resetTopIndexCircuitBreaker(): void {
  topIndexUnavailable = false;
}

/**
 * Fetch one page of the landed-trick feed.
 *
 * `sort` selects the ranking strategy:
 *   • 'top' (default) — `upvoteCount` desc, then `createdAt` desc, then doc
 *     id desc. The createdAt tiebreaker means a collection where every clip
 *     has zero upvotes naturally falls through to most-recent-first, so the
 *     featured-clip surface degrades gracefully before vote data exists.
 *   • 'new' — `createdAt` desc, then doc id desc. Legacy ordering, kept for
 *     the Top/New toggle.
 *
 * The doc-id tiebreaker exists because set + match clips share a transaction
 * `serverTimestamp()`; without it pagination would skip or duplicate rows at
 * page boundaries.
 */
export async function fetchClipsFeed(
  cursor: ClipsFeedCursor | null = null,
  pageSize = 20,
  sort: ClipsFeedSort = "top",
): Promise<ClipsFeedPage> {
  // If the 'top' index has already failed once this session, skip the
  // wasted round-trip and serve from 'new' directly. The cursor format
  // differs between sorts, so a 'top'-shaped cursor must be dropped here
  // — callers that paginate through the fallback get a fresh first page.
  if (sort === "top" && topIndexUnavailable) {
    return runFeedQuery(null, pageSize, "new");
  }

  try {
    return await runFeedQuery(cursor, pageSize, sort);
  } catch (err) {
    if (sort === "top" && isMissingIndexError(err)) {
      // Latch the breaker so the rest of the session skips the failing
      // top query entirely. Logged once per session for ops visibility.
      topIndexUnavailable = true;
      logger.warn("clips_feed_top_index_unavailable_falling_back_to_new", {
        error: parseFirebaseError(err),
      });
      return runFeedQuery(null, pageSize, "new");
    }
    throw err;
  }
}

function isMissingIndexError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code !== "failed-precondition") return false;
  // Firestore raises failed-precondition for several reasons; the missing-
  // index variant carries "requires an index" in its message. Be tolerant
  // — if we can't read the message, treat the code as sufficient signal so
  // the fallback still triggers in surface-stripped error envelopes.
  const message = (err as { message?: unknown }).message;
  if (typeof message !== "string") return true;
  return message.toLowerCase().includes("index");
}

async function runFeedQuery(
  cursor: ClipsFeedCursor | null,
  pageSize: number,
  sort: ClipsFeedSort,
): Promise<ClipsFeedPage> {
  const boundedSize = Math.max(1, Math.min(50, pageSize));

  // App Store Guideline 1.2 requires offensive UGC to be removable from
  // the feed. Hidden clips (moderationStatus === 'hidden') are filtered
  // out server-side. Paired with composite indexes in firestore.indexes.json:
  //   • new: (moderationStatus, createdAt desc, __name__ desc)
  //   • top: (moderationStatus, upvoteCount desc, createdAt desc, __name__ desc)
  const constraints: QueryConstraint[] =
    sort === "top"
      ? [
          where("moderationStatus", "==", "active"),
          orderBy("upvoteCount", "desc"),
          orderBy("createdAt", "desc"),
          orderBy(documentId(), "desc"),
        ]
      : [where("moderationStatus", "==", "active"), orderBy("createdAt", "desc"), orderBy(documentId(), "desc")];
  if (cursor) {
    // startAfter must match the orderBy chain length-for-length. For 'top'
    // we thread upvoteCount through (defaulting to 0 if a caller round-trips
    // a 'new'-sourced cursor by mistake — defensive, not a real path).
    constraints.push(
      sort === "top"
        ? startAfter(cursor.upvoteCount ?? 0, cursor.createdAt, cursor.id)
        : startAfter(cursor.createdAt, cursor.id),
    );
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
  const lastRawData = lastRaw
    ? (lastRaw.data() as { createdAt?: unknown; upvoteCount?: unknown } | undefined)
    : undefined;
  const lastRawCreatedAt = lastRawData?.createdAt;
  const lastRawUpvoteCount =
    typeof lastRawData?.upvoteCount === "number" && Number.isFinite(lastRawData.upvoteCount)
      ? lastRawData.upvoteCount
      : 0;
  const nextCursor: ClipsFeedCursor | null =
    lastRaw && lastRawCreatedAt instanceof Timestamp
      ? sort === "top"
        ? { createdAt: lastRawCreatedAt, id: lastRaw.id, upvoteCount: lastRawUpvoteCount }
        : { createdAt: lastRawCreatedAt, id: lastRaw.id }
      : (() => {
          const last = clips[clips.length - 1];
          if (!last || !last.createdAt) return null;
          return sort === "top"
            ? { createdAt: last.createdAt, id: last.id, upvoteCount: last.upvoteCount }
            : { createdAt: last.createdAt, id: last.id };
        })();

  return { clips, cursor: nextCursor };
}
