/**
 * Verdict write + viewer-state read paths for community disputes.
 *
 * NOT BINDING ON GAME STATE. A verdict only creates a `disputeVotes` doc and
 * bumps the matching aggregate on the dispute. No letters are written, no
 * turn is advanced, and the game doc's `phase`/`currentTurn` are never
 * touched. Record and tally only — making the crowd verdict binding is a
 * separate, additive step (see `src/types/dispute.ts`).
 *
 * Uniqueness is enforced by the deterministic `{uid}_{disputeId}` doc id; the
 * matching `disputeVotes` rule disallows updates and lets `runTransaction`
 * keep `landVotes`/`bailVotes` consistent with the underlying vote docs —
 * the same arrangement as `clipVotes` / `clips.upvoteCount`.
 */

import { doc, documentId, getDoc, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import {
  coerceVoteCount,
  disputeVoteId,
  disputeVotesRef,
  type Dispute,
  type DisputeTally,
  type DisputeVerdict,
  type DisputeViewerState,
} from "./disputes.mappers";

/**
 * Thrown by `castDisputeVerdict` when the caller has already ruled on this
 * dispute. One verdict per viewer, no changing your mind — the UI converts
 * this into the "already ruled" state rather than an error toast.
 */
export class AlreadyRuledError extends Error {
  constructor(public readonly disputeId: string) {
    super(`already_ruled:${disputeId}`);
    this.name = "AlreadyRuledError";
  }
}

/**
 * Thrown by `castDisputeVerdict` when the caller is one of the two players in
 * the disputed game. You never get to judge your own trick — neither the
 * setter who raised the dispute nor the matcher whose claim is under
 * judgement may vote on it.
 */
export class OwnDisputeError extends Error {
  constructor(public readonly disputeId: string) {
    super(`own_dispute:${disputeId}`);
    this.name = "OwnDisputeError";
  }
}

/**
 * Thrown by `castDisputeVerdict` when the dispute is no longer accepting
 * verdicts — either closed, or gone entirely (a deleted dispute is closed as
 * far as a would-be voter is concerned).
 */
export class DisputeClosedError extends Error {
  constructor(public readonly disputeId: string) {
    super(`dispute_closed:${disputeId}`);
    this.name = "DisputeClosedError";
  }
}

/** Firestore caps `where(... in [...])` lists at 30 values. */
const VOTE_DOC_IN_BATCH_LIMIT = 30;

/**
 * Hydrate the viewer's relationship to a page of disputes with at most 1–2
 * Firestore reads.
 *
 * The tally already lives on each dispute doc (transactionally maintained by
 * `castDisputeVerdict`), so the only network work is discovering which of
 * these disputes the viewer has already ruled on: a single batched
 * `getDocs(query(disputeVotes, where(__name__, in, [...])))` keyed on the
 * deterministic `{uid}_{disputeId}` vote-doc ids — exactly the shape
 * `fetchClipUpvoteState` uses.
 *
 * The two players are filtered out before the network call: `castDisputeVerdict`
 * rejects them, so hydrating their state would burn reads with no UI value.
 * They are still present in the returned map, marked `canVote: false`.
 *
 * Closed disputes ARE looked up — a viewer should still see how they ruled
 * on a finished dispute — but come back `canVote: false`.
 *
 * `canVote` intentionally reflects only eligibility (not a player, still
 * open), matching the `DisputeViewerState` contract. A viewer who has
 * already ruled is identified by a non-null `ownVerdict`.
 *
 * Best-effort: a failed lookup is logged once and every entry keeps its
 * seeded `ownVerdict: null` fallback, so the feed still renders with correct
 * tallies and eligibility. The state self-corrects on the next tap via
 * `AlreadyRuledError`.
 */
export async function fetchDisputeViewerState(
  uid: string,
  disputes: readonly Dispute[],
): Promise<Map<string, DisputeViewerState>> {
  const result = new Map<string, DisputeViewerState>();
  if (disputes.length === 0) return result;

  // Seed every dispute up front so a network failure below still yields
  // useful UI state.
  const targets: Dispute[] = [];
  for (const d of disputes) {
    const isPlayer = d.setterUid === uid || d.matcherUid === uid;
    result.set(d.id, { ownVerdict: null, canVote: !isPlayer && d.status === "open" });
    // Players can never have a vote doc — skip the read entirely.
    if (!isPlayer) targets.push(d);
  }
  if (targets.length === 0) return result;

  // Chunk vote-doc ids to respect Firestore's 30-value `in` cap. Page sizes
  // are well under that today; the loop is here so future growth doesn't
  // silently exceed the limit.
  const chunks: string[][] = [];
  for (let i = 0; i < targets.length; i += VOTE_DOC_IN_BATCH_LIMIT) {
    chunks.push(targets.slice(i, i + VOTE_DOC_IN_BATCH_LIMIT).map((d) => disputeVoteId(uid, d.id)));
  }

  try {
    const snaps = await Promise.all(
      chunks.map((voteIds) => withRetry(() => getDocs(query(disputeVotesRef(), where(documentId(), "in", voteIds))))),
    );
    for (const snap of snaps) {
      for (const d of snap.docs) {
        // The doc body carries disputeId and verdict verbatim (written by
        // castDisputeVerdict); prefer them over re-deriving from the doc id
        // so a legacy or malformed id format can't poison the lookup.
        const data = d.data() as { disputeId?: unknown; verdict?: unknown };
        const disputeId = typeof data.disputeId === "string" ? data.disputeId : null;
        const verdict = data.verdict === "land" || data.verdict === "bail" ? data.verdict : null;
        if (disputeId && verdict && result.has(disputeId)) {
          const existing = result.get(disputeId)!;
          result.set(disputeId, { ownVerdict: verdict, canVote: existing.canVote });
        }
      }
    }
  } catch (err) {
    // Page-wide failure: log once and keep the seeded defaults.
    logger.warn("dispute_viewer_state_batch_failed", { error: parseFirebaseError(err) });
  }

  return result;
}

/**
 * Record one viewer's verdict on a dispute and return the resulting tally.
 *
 * The transaction reads the vote doc and the dispute together via
 * `Promise.all` so the read phase costs a single round-trip, then writes the
 * vote doc AND the incremented counter as a literal (`current + 1`, never
 * `increment(1)`). The literal lets us return the authoritative post-write
 * tally without a follow-up read, and it is the shape the security rule
 * matches — identical reasoning to `upvoteClip`.
 *
 * Only the counter that actually moved is written: the rule pairs a single
 * `+1` field delta with the matching vote-doc create-after, so a client
 * cannot inflate a tally without also creating its vote doc.
 *
 * Errors:
 *  • `AlreadyRuledError` — the caller already has a vote doc.
 *  • `OwnDisputeError`   — the caller is the setter or the matcher.
 *  • `DisputeClosedError`— the dispute is closed, or does not exist.
 */
export async function castDisputeVerdict(
  uid: string,
  disputeId: string,
  verdict: DisputeVerdict,
): Promise<DisputeTally> {
  const db = requireDb();
  const voteRef = doc(db, "disputeVotes", disputeVoteId(uid, disputeId));
  const disputeRef = doc(db, "disputes", disputeId);

  let tally: DisputeTally = { land: 0, bail: 0 };
  try {
    await runTransaction(db, async (tx) => {
      const [existing, disputeSnap] = await Promise.all([tx.get(voteRef), tx.get(disputeRef)]);
      if (existing.exists()) throw new AlreadyRuledError(disputeId);
      // A dispute that vanished mid-session is closed for voting purposes;
      // callers only ever need to handle one "you can't vote on this" error.
      if (!disputeSnap.exists()) throw new DisputeClosedError(disputeId);

      const data = disputeSnap.data() as {
        setterUid?: unknown;
        matcherUid?: unknown;
        status?: unknown;
        landVotes?: unknown;
        bailVotes?: unknown;
      };
      if (data.setterUid === uid || data.matcherUid === uid) throw new OwnDisputeError(disputeId);
      if (data.status !== "open") throw new DisputeClosedError(disputeId);

      // Legacy/absent aggregates read as 0, mirroring the mapper and the
      // rule's `get(field, 0)`, so the literal we write always matches the
      // value the rule compares against.
      const land = coerceVoteCount(data.landVotes);
      const bail = coerceVoteCount(data.bailVotes);
      tally = verdict === "land" ? { land: land + 1, bail } : { land, bail: bail + 1 };

      tx.set(voteRef, {
        uid,
        disputeId,
        verdict,
        createdAt: serverTimestamp(),
      });
      // Literal, single-field delta — see the docblock.
      tx.update(disputeRef, verdict === "land" ? { landVotes: tally.land } : { bailVotes: tally.bail });
    });
  } catch (err) {
    if (err instanceof AlreadyRuledError || err instanceof OwnDisputeError || err instanceof DisputeClosedError) {
      throw err;
    }
    // permission-denied is ambiguous here. Either the vote doc already exists
    // and the rules rejected the implicit overwrite (a lost double-tap race,
    // mirrors `upvoteClip`), or the dispute closed between feed render and
    // tap: closed disputes are participant/voter-only reads, so the tx.get
    // above is itself denied for a would-be first-time voter. The vote doc is
    // owner-readable, so one follow-up read on this error path tells the two
    // apart; if even that read fails, "closed" is the safe terminal state.
    const code = (err as { code?: string }).code;
    if (code === "permission-denied") {
      const voteSnap = await getDoc(voteRef).catch(() => null);
      if (voteSnap?.exists()) throw new AlreadyRuledError(disputeId);
      throw new DisputeClosedError(disputeId);
    }
    throw err;
  }

  return tally;
}
