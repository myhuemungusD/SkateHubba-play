/**
 * Up/down vote write + read paths for clips.
 *
 * One vote per (clip, user), enforced by the deterministic `{uid}_{clipId}`
 * doc id. The vote's direction lives in `value: 1 | -1` on the vote doc, and
 * each direction has its own denormalized aggregate on the parent clip
 * (`upvoteCount` / `downvoteCount`). Every mutation pairs the vote-doc write
 * with the matching counter delta inside ONE `runTransaction`, so a
 * half-applied state — a vote doc with no counter, or a counter with no vote
 * doc — is not reachable.
 *
 * Changing your mind (flip) is a delete + create of the SAME vote doc id in a
 * single transaction, carrying two counter deltas (+1 on the new direction,
 * −1 on the old). It is expressed as delete-then-set rather than an update
 * because the `clipVotes` rule is `allow update: if false` — vote docs are
 * immutable, and a flip is a new vote, not an edited one.
 *
 * Ranking is unaffected: the feed still sorts on `upvoteCount` alone.
 * `downvoteCount` is display and moderation signal only.
 *
 * `clips.upvotes.ts` wraps this module with the legacy upvote-only surface.
 */

import { deleteDoc, doc, documentId, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import { clipVoteId, clipVotesRef } from "./clips.mappers";

/** Direction of a vote. Persisted verbatim as `clipVotes/{id}.value`. */
export type ClipVoteValue = 1 | -1;

/**
 * Thrown when the caller already holds a vote in the requested direction.
 * Not an error condition for the UI — the control is already in that state,
 * so callers reconcile silently rather than showing a toast.
 */
export class AlreadyVotedError extends Error {
  constructor(
    public readonly clipId: string,
    public readonly value: ClipVoteValue,
  ) {
    super(`already_voted:${clipId}:${value}`);
    this.name = "AlreadyVotedError";
  }
}

/**
 * Thrown when the caller tries to vote on their own clip, in EITHER
 * direction. Self-upvotes are also blocked by the `clipVotes` create rule;
 * this guard exists so the client never issues the doomed write and so the
 * owner's own controls can be rendered inert without a round-trip.
 */
export class SelfVoteError extends Error {
  constructor(public readonly clipId: string) {
    super(`self_vote:${clipId}`);
    this.name = "SelfVoteError";
  }
}

/** Thrown by {@link removeClipVote} when there is no vote to withdraw. */
export class NotVotedError extends Error {
  constructor(public readonly clipId: string) {
    super(`not_voted:${clipId}`);
    this.name = "NotVotedError";
  }
}

/**
 * Per-clip vote state for the feed: both live counts plus the viewer's own
 * position (`null` when they haven't voted). This is the shape the UI binds
 * its two controls to.
 */
export interface ClipVoteState {
  upvoteCount: number;
  downvoteCount: number;
  myVote: ClipVoteValue | null;
}

/** Minimal clip shape required to hydrate vote state. */
export interface ClipForVoteHydration {
  id: string;
  upvoteCount: number;
  downvoteCount: number;
  playerUid: string;
}

/** Firestore caps `where(... in [...])` lists at 30 values. */
const VOTE_DOC_IN_BATCH_LIMIT = 30;

/** Non-negative count read, mirroring the rules' `get(field, 0)` default. */
function toCount(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

/**
 * Read a persisted vote doc's direction.
 *
 * Vote docs written before downvoting shipped carry no `value` field; they
 * were all upvotes, so absence reads as `1`. Any other unexpected value is
 * also read as an upvote for the same reason — the pre-`value` corpus is the
 * only way to get here.
 */
function toVoteValue(raw: unknown): ClipVoteValue {
  return raw === -1 ? -1 : 1;
}

/** Counter field a vote of the given direction contributes to. */
function counterField(value: ClipVoteValue): "upvoteCount" | "downvoteCount" {
  return value === 1 ? "upvoteCount" : "downvoteCount";
}

/**
 * Hydrate vote state for a page of clips with at most 1–2 Firestore reads.
 *
 * The clip docs already carry both aggregates, so counts are copied from the
 * supplied docs and the only network work is discovering which of them the
 * caller has voted on: a single batched
 * `getDocs(query(clipVotes, where(__name__, in, [...])))` keyed on the
 * deterministic `${uid}_${clipId}` ids. Reads scale as
 * `ceil(clips.length / 30)`, i.e. 1 at any realistic page size.
 *
 * Own clips are skipped before the network call — voting on them is rejected
 * in both directions, so hydrating their state would burn reads for a UI
 * state that can never be anything but `myVote: null`.
 *
 * Failures are swallowed and every entry falls back to `myVote: null` with
 * accurate counts: a viewer blocked by App Check still sees correct numbers,
 * and their own position self-corrects the moment they tap.
 */
export async function fetchClipVoteState(
  uid: string,
  clips: ReadonlyArray<ClipForVoteHydration>,
): Promise<Map<string, ClipVoteState>> {
  const result = new Map<string, ClipVoteState>();
  if (clips.length === 0) return result;

  const targetClips = clips.filter((c) => c.playerUid !== uid);

  // Seed every target up front so a network failure below still yields
  // useful UI state.
  for (const c of targetClips) {
    result.set(c.id, { upvoteCount: c.upvoteCount, downvoteCount: c.downvoteCount, myVote: null });
  }
  if (targetClips.length === 0) return result;

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
        // Prefer the doc body's clipId over re-deriving it from the doc id,
        // so a legacy or malformed id format can't poison the lookup.
        const data = d.data() as { clipId?: unknown; value?: unknown };
        const clipId = typeof data.clipId === "string" ? data.clipId : null;
        const existing = clipId === null ? undefined : result.get(clipId);
        if (existing) {
          result.set(clipId as string, { ...existing, myVote: toVoteValue(data.value) });
        }
      }
    }
  } catch (err) {
    logger.warn("clip_vote_state_batch_failed", { error: parseFirebaseError(err) });
  }

  return result;
}

/**
 * Cast (or flip) the caller's vote on a clip and return the resulting state.
 *
 * Three cases, all handled in one transaction:
 *
 *   1. No existing vote — create the vote doc, +1 on the matching counter.
 *   2. Existing vote in the SAME direction — `AlreadyVotedError`, no write.
 *      Callers that want tap-to-toggle call {@link removeClipVote} instead;
 *      making a repeat tap silently withdraw the vote here would make the
 *      two operations indistinguishable from a caller's point of view.
 *   3. Existing vote in the OTHER direction — delete + re-create the vote
 *      doc at the same id, +1 on the new counter and −1 on the old.
 *
 * Counters are written as literals rather than `increment()` so the
 * post-write state can be returned without a second read, and because the
 * `clips` update rule matches on exactly `prev ± 1`.
 *
 * Drift guard: a counter that is already 0 is never decremented below 0
 * (the rule floors at 0 and would reject the whole transaction). That case
 * is only reachable through out-of-band edits; the flip's +1 side still
 * applies, so the vote doc and the counters converge rather than stranding
 * the flip.
 */
export async function castClipVote(uid: string, clipId: string, value: ClipVoteValue): Promise<ClipVoteState> {
  const db = requireDb();
  const voteRef = doc(db, "clipVotes", clipVoteId(uid, clipId));
  const clipRef = doc(db, "clips", clipId);

  let state: ClipVoteState = { upvoteCount: 0, downvoteCount: 0, myVote: value };

  try {
    await runTransaction(db, async (tx) => {
      // Both reads issued together so the transaction's read phase costs a
      // single round-trip.
      const [existing, clipSnap] = await Promise.all([tx.get(voteRef), tx.get(clipRef)]);
      const clipData = clipSnap.exists() ? (clipSnap.data() as Record<string, unknown>) : undefined;

      if (clipData && clipData.playerUid === uid) throw new SelfVoteError(clipId);

      const previous = existing.exists() ? toVoteValue((existing.data() as { value?: unknown }).value) : null;
      if (previous === value) throw new AlreadyVotedError(clipId, value);

      const counts: Record<"upvoteCount" | "downvoteCount", number> = {
        upvoteCount: toCount(clipData?.upvoteCount),
        downvoteCount: toCount(clipData?.downvoteCount),
      };

      const updates: Partial<Record<"upvoteCount" | "downvoteCount", number>> = {};

      const addField = counterField(value);
      counts[addField] += 1;
      updates[addField] = counts[addField];

      if (previous !== null) {
        const dropField = counterField(previous);
        if (counts[dropField] > 0) {
          counts[dropField] -= 1;
          updates[dropField] = counts[dropField];
        }
        // Vote docs are immutable (`allow update: if false`), so a flip is a
        // delete followed by a fresh create at the same id — ordered writes
        // inside one transaction, committed atomically.
        tx.delete(voteRef);
      }

      tx.set(voteRef, { uid, clipId, value, createdAt: serverTimestamp() });
      tx.update(clipRef, updates);

      state = { upvoteCount: counts.upvoteCount, downvoteCount: counts.downvoteCount, myVote: value };
    });
  } catch (err) {
    if (err instanceof AlreadyVotedError || err instanceof SelfVoteError) throw err;
    // A clean create rejected as permission-denied almost always means the
    // vote doc already exists and the immutability rule refused the implicit
    // overwrite. Surface the business-level error so callers have one thing
    // to handle.
    if ((err as { code?: string }).code === "permission-denied") throw new AlreadyVotedError(clipId, value);
    throw err;
  }

  return state;
}

/**
 * Withdraw the caller's vote on a clip, whichever direction it was, and
 * return the resulting state.
 *
 * Decrements the counter matching the withdrawn vote's OWN value — taking
 * back a downvote must not deflate `upvoteCount`.
 *
 * Throws `NotVotedError` when there is nothing to withdraw; callers treat
 * that as a no-op.
 *
 * Aggregate-drift edge case: if the relevant counter is already 0 while a
 * vote doc exists (out-of-band admin edits, or a legacy vote older than the
 * aggregate backfill), decrementing would write −1 and be rejected by the
 * rule's `>= 0` floor, stranding the vote doc forever. In that case the vote
 * is deleted on its own after the transaction — the owner-only `clipVotes`
 * delete rule permits it — leaving the count at 0, already the correct floor.
 */
export async function removeClipVote(uid: string, clipId: string): Promise<ClipVoteState> {
  const db = requireDb();
  const voteRef = doc(db, "clipVotes", clipVoteId(uid, clipId));
  const clipRef = doc(db, "clips", clipId);

  let state: ClipVoteState = { upvoteCount: 0, downvoteCount: 0, myVote: null };
  let orphanedVote = false;

  await runTransaction(db, async (tx) => {
    // Reset per-attempt: runTransaction replays its callback on contention,
    // and a stale flag from an aborted attempt would misroute the cleanup.
    orphanedVote = false;

    const [existing, clipSnap] = await Promise.all([tx.get(voteRef), tx.get(clipRef)]);
    if (!existing.exists()) throw new NotVotedError(clipId);

    const previous = toVoteValue((existing.data() as { value?: unknown }).value);
    const clipData = clipSnap.exists() ? (clipSnap.data() as Record<string, unknown>) : undefined;
    const counts: Record<"upvoteCount" | "downvoteCount", number> = {
      upvoteCount: toCount(clipData?.upvoteCount),
      downvoteCount: toCount(clipData?.downvoteCount),
    };

    const field = counterField(previous);
    if (!clipData || counts[field] <= 0) {
      // Nothing legal to decrement, or the clip was deleted out from under
      // the vote. Drop the vote doc after the transaction so the write set
      // stays a single legal operation.
      orphanedVote = true;
      state = { upvoteCount: counts.upvoteCount, downvoteCount: counts.downvoteCount, myVote: null };
      return;
    }

    counts[field] -= 1;
    tx.delete(voteRef);
    tx.update(clipRef, { [field]: counts[field] });
    state = { upvoteCount: counts.upvoteCount, downvoteCount: counts.downvoteCount, myVote: null };
  });

  if (orphanedVote) {
    try {
      await deleteDoc(voteRef);
    } catch (err) {
      // Best-effort: the count is already at its floor, so a failed cleanup
      // leaves the UI correct and merely keeps a stale vote doc around.
      logger.warn("clip_vote_orphan_delete_failed", { clipId, error: parseFirebaseError(err) });
    }
  }

  return state;
}
