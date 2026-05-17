/**
 * Upvote write + read paths for clips.
 *
 * Uniqueness is enforced by the deterministic `{uid}_{clipId}` doc id; the
 * matching `clipVotes` rule disallows updates and lets `runTransaction` keep
 * the parent clip's `upvoteCount` aggregate consistent with the underlying
 * vote docs.
 */

import {
  doc,
  documentId,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import { clipVoteId, clipVotesRef } from "./clips.mappers";

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

/** Per-clip upvote state for the lobby feed: live count + whether the
 *  current viewer has already upvoted (controls the filled/disabled UI). */
export interface ClipUpvoteState {
  count: number;
  alreadyUpvoted: boolean;
}

/** Firestore caps `where(... in [...])` lists at 30 values. */
const VOTE_DOC_IN_BATCH_LIMIT = 30;

/** Minimal clip shape required to hydrate upvote state: id, denormalized
 *  upvoteCount aggregate, and the owner uid (used to skip self-upvote
 *  hydration since the rule disallows it anyway). */
export interface ClipForUpvoteHydration {
  id: string;
  upvoteCount: number;
  playerUid: string;
}

/**
 * Hydrate upvote state for a page of clips with at most 1–2 Firestore reads.
 *
 * The clip doc already carries the `upvoteCount` aggregate (transactionally
 * incremented inside `upvoteClip`), so per-clip count reads are unnecessary
 * — we copy the value from the supplied clip docs. The only network work is
 * checking which of the supplied clips the caller has already upvoted: a
 * single batched `getDocs(query(clipVotes, where(__name__, in, [...])))`
 * keyed on the deterministic `${uid}_${clipId}` vote-doc ids.
 *
 * Reads: `ceil(targetClips.length / 30)` — 1 for PAGE_SIZE ≤ 30, never more
 * than 2 in practice. Down from `2 * clipIds.length` (24 at PAGE_SIZE=12) in
 * the previous implementation.
 *
 * Own clips are filtered out before the network call because `upvoteClip`
 * rejects self-upvotes; hydrating their state would burn reads with no UI
 * value. Callers no longer need to pre-filter.
 *
 * Failures are swallowed and the affected entries fall back to
 * `{ count: clip.upvoteCount, alreadyUpvoted: false }` — viewers see
 * accurate counts even when App Check blocks the vote-doc lookup; the
 * "alreadyUpvoted" UI state self-corrects when the user actually taps.
 */
export async function fetchClipUpvoteState(
  uid: string,
  clips: ReadonlyArray<ClipForUpvoteHydration>,
): Promise<Map<string, ClipUpvoteState>> {
  const result = new Map<string, ClipUpvoteState>();
  if (clips.length === 0) return result;

  // Self-upvote is disallowed by rules + by upvoteClip; never burn a read
  // hydrating it. The owner's display always reads as not-upvoted.
  const targetClips = clips.filter((c) => c.playerUid !== uid);

  // Seed every target with the denormalized count up front so a network
  // failure below still yields useful UI state.
  for (const c of targetClips) {
    result.set(c.id, { count: c.upvoteCount, alreadyUpvoted: false });
  }
  if (targetClips.length === 0) return result;

  // Chunk vote-doc ids to respect Firestore's 30-value `in` cap. PAGE_SIZE
  // is 12 so this is almost always a single chunk; the loop is here so
  // future page-size growth doesn't silently exceed the limit.
  const chunks: string[][] = [];
  for (let i = 0; i < targetClips.length; i += VOTE_DOC_IN_BATCH_LIMIT) {
    chunks.push(targetClips.slice(i, i + VOTE_DOC_IN_BATCH_LIMIT).map((c) => clipVoteId(uid, c.id)));
  }

  try {
    const snaps = await Promise.all(
      chunks.map((voteIds) => withRetry(() => getDocs(query(clipVotesRef(), where(documentId(), "in", voteIds))))),
    );
    for (const snap of snaps) {
      for (const d of snap.docs) {
        // The doc data carries clipId verbatim (written by upvoteClip);
        // prefer it over re-deriving from the doc id so a malformed or
        // legacy id format doesn't poison the lookup.
        const data = d.data() as { clipId?: unknown };
        const clipId = typeof data.clipId === "string" ? data.clipId : null;
        if (clipId && result.has(clipId)) {
          const existing = result.get(clipId)!;
          result.set(clipId, { count: existing.count, alreadyUpvoted: true });
        }
      }
    }
  } catch (err) {
    // Page-wide failure: log once and keep the seeded `alreadyUpvoted=false`
    // defaults. Per-tap upvote attempts will resync via AlreadyUpvotedError.
    logger.warn("clip_upvote_state_batch_failed", { error: parseFirebaseError(err) });
  }

  return result;
}

/**
 * Record a single upvote on a clip and return the resulting count.
 *
 * Uniqueness is enforced by the deterministic `{uid}_{clipId}` doc id: the
 * transaction reads the doc and throws `AlreadyUpvotedError` when it already
 * exists. The `clipVotes` rule additionally enforces this via
 * `allow update: if false` so a rule-only client can't double-vote by
 * setDoc-ing over the existing entry (deletes are owner-only and back the
 * un-upvote / account-deletion paths).
 *
 * The same transaction also bumps the parent clip's `upvoteCount` aggregate
 * by reading the current value and writing `current + 1` as a literal. The
 * literal write lets us return the authoritative post-tx count without a
 * follow-up aggregate read (one fewer round-trip per tap). Pairing the
 * vote-doc create and the count delta in one `runTransaction` keeps the
 * aggregate consistent with the underlying votes — a half-applied write
 * (vote doc but no count, or count but no vote doc) is impossible. The
 * matching firestore rule on `clips` uses `existsAfter` to verify the
 * vote-doc side of the pair, so a client cannot inflate the count without
 * also creating its vote doc.
 */
export async function upvoteClip(uid: string, clipId: string): Promise<number> {
  const db = requireDb();
  const voteRef = doc(db, "clipVotes", clipVoteId(uid, clipId));
  const clipRef = doc(db, "clips", clipId);

  let nextCount = 0;
  try {
    await runTransaction(db, async (tx) => {
      // Read both refs together so the transaction's read phase finishes
      // in a single round-trip. We need the clip doc to compute the post-
      // increment count and return it without a follow-up aggregate read.
      const [existing, clipSnap] = await Promise.all([tx.get(voteRef), tx.get(clipRef)]);
      if (existing.exists()) throw new AlreadyUpvotedError(clipId);

      // Legacy clips lack `upvoteCount` on disk; the rule treats missing as
      // 0 via `get('upvoteCount', 0)` and the mapper does the same on read.
      // Mirror both here so the literal we write matches the rule's check.
      const raw = clipSnap.exists() ? (clipSnap.data() as { upvoteCount?: unknown }).upvoteCount : 0;
      const currentCount = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 0;
      nextCount = currentCount + 1;

      tx.set(voteRef, {
        uid,
        clipId,
        createdAt: serverTimestamp(),
      });
      // Writing a literal (rather than `increment(1)`) lets us return the
      // authoritative post-write count without a second read. The rule at
      // firestore.rules:1487 explicitly accepts this shape — it requires
      // upvoteCount == prev + 1 paired with a vote-doc create-after.
      tx.update(clipRef, { upvoteCount: nextCount });
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

  return nextCount;
}
