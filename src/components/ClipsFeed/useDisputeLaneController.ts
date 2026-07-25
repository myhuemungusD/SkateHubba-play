/**
 * State + write orchestration for the dispute lane of the lobby feed.
 *
 * Mirrors `useClipsFeedController`: all state and handlers here, JSX in
 * `DisputeLane.tsx`. Keeping them apart is what holds ClipsFeed/index.tsx
 * inside the 250 LOC component budget.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlreadyRuledError,
  DisputeClosedError,
  OwnDisputeError,
  castDisputeVerdict,
  fetchDisputeViewerState,
  fetchOpenDisputes,
} from "../../services/disputes";
import type { Dispute, DisputeTally, DisputeVerdict, DisputeViewerState } from "../../types/dispute";
import { trackEvent } from "../../services/analytics";
import { logger } from "../../services/logger";
import { parseFirebaseError } from "../../utils/helpers";
import { useBlockedUsers } from "../../hooks/useBlockedUsers";

const PAGE_SIZE = 8;

/**
 * What we assume before `fetchDisputeViewerState` has answered. `canVote:
 * false` is the safe default — the tally renders, the verdict buttons don't,
 * so a viewer can never fire a write we already know the rules would bounce
 * (their own game, or a closed dispute).
 */
const UNKNOWN_VIEWER: DisputeViewerState = { ownVerdict: null, canVote: false };

/** Shared fallback so a cache miss doesn't hand memoised cards a fresh object. */
const ZERO_TALLY: DisputeTally = { land: 0, bail: 0 };

export interface DisputeLaneController {
  disputes: readonly Dispute[];
  loading: boolean;
  error: string | null;
  tallyFor: (disputeId: string) => DisputeTally;
  viewerFor: (disputeId: string) => DisputeViewerState;
  isVoting: (disputeId: string) => boolean;
  reload: () => void;
  handleVerdict: (dispute: Dispute, verdict: DisputeVerdict) => Promise<void>;
}

export function useDisputeLaneController(viewerUid: string): DisputeLaneController {
  const [disputes, setDisputes] = useState<readonly Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tallies, setTallies] = useState<ReadonlyMap<string, DisputeTally>>(new Map());
  const [viewerState, setViewerState] = useState<ReadonlyMap<string, DisputeViewerState>>(new Map());
  const [votingIds, setVotingIds] = useState<ReadonlySet<string>>(new Set());

  const blockedUids = useBlockedUsers(viewerUid);

  // Guard against setState-after-unmount during fetch races.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Same ref mirroring as the clips controller: handlers read the latest
  // tally / viewer / in-flight state without listing them as deps, so
  // `handleVerdict` keeps a stable identity and React.memo on DisputeCard
  // actually skips re-rendering the video subtree on every vote.
  const talliesRef = useRef<ReadonlyMap<string, DisputeTally>>(tallies);
  useEffect(() => {
    talliesRef.current = tallies;
  }, [tallies]);
  const viewerStateRef = useRef<ReadonlyMap<string, DisputeViewerState>>(viewerState);
  useEffect(() => {
    viewerStateRef.current = viewerState;
  }, [viewerState]);
  const votingIdsRef = useRef<ReadonlySet<string>>(votingIds);
  useEffect(() => {
    votingIdsRef.current = votingIds;
  }, [votingIds]);

  const beginVote = useCallback((disputeId: string) => {
    setVotingIds((prev) => {
      const next = new Set(prev);
      next.add(disputeId);
      return next;
    });
  }, []);

  const endVote = useCallback((disputeId: string) => {
    if (!mountedRef.current) return;
    setVotingIds((prev) => {
      const next = new Set(prev);
      next.delete(disputeId);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const open = await fetchOpenDisputes(PAGE_SIZE);
      if (!mountedRef.current) return;
      setDisputes(open);
      // Seed from the server-maintained aggregates on the dispute docs — no
      // fan-out count query, same trick `clips.upvoteCount` uses.
      setTallies(new Map(open.map((d) => [d.id, { land: d.landVotes, bail: d.bailVotes }])));
      // Best-effort: a failure here leaves every card in the read-only
      // tally state rather than blocking the lane.
      try {
        const states = await fetchDisputeViewerState(viewerUid, open);
        if (!mountedRef.current) return;
        setViewerState(states);
      } catch (err) {
        logger.warn("dispute_lane_viewer_state_failed", { error: parseFirebaseError(err) });
      }
    } catch (err) {
      logger.warn("dispute_lane_load_failed", { error: parseFirebaseError(err) });
      if (mountedRef.current) setError("Couldn't load the calls waiting on the community.");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [viewerUid]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleVerdict = useCallback(
    async (dispute: Dispute, verdict: DisputeVerdict) => {
      const id = dispute.id;
      const viewer = viewerStateRef.current.get(id) ?? UNKNOWN_VIEWER;
      // A verdict is one-shot: no re-rules, no double-taps, no voting on a
      // dispute the server has already told us we can't touch.
      if (!viewer.canVote || viewer.ownVerdict !== null || votingIdsRef.current.has(id)) return;

      const previous = talliesRef.current.get(id) ?? { land: dispute.landVotes, bail: dispute.bailVotes };
      const optimistic: DisputeTally =
        verdict === "land"
          ? { land: previous.land + 1, bail: previous.bail }
          : { land: previous.land, bail: previous.bail + 1 };

      beginVote(id);
      setTallies((prev) => new Map(prev).set(id, optimistic));
      setViewerState((prev) => new Map(prev).set(id, { ownVerdict: verdict, canVote: false }));

      try {
        const settled = await castDisputeVerdict(viewerUid, id, verdict);
        if (!mountedRef.current) return;
        trackEvent("dispute_verdict_cast", { disputeId: id, gameId: dispute.gameId, verdict });
        setTallies((prev) => new Map(prev).set(id, settled));
      } catch (err) {
        if (!mountedRef.current) return;
        // The three typed outcomes below are business truths, not failures:
        // reconcile the card to what they imply and stay silent.
        if (err instanceof AlreadyRuledError) {
          // Our vote is already on record (retry replay, or another tab).
          // Same reconciliation as AlreadyUpvotedError on clips: the
          // optimistic state IS the server state, so keep it.
          return;
        }
        if (err instanceof OwnDisputeError || err instanceof DisputeClosedError) {
          // Nothing was counted — undo the increment, and lock the card:
          // a player never gets a vote, and a closed dispute takes none.
          rollbackTally(setTallies, id, optimistic, previous);
          setViewerState((prev) => new Map(prev).set(id, { ownVerdict: null, canVote: false }));
          return;
        }
        logger.warn("dispute_verdict_failed", { disputeId: id, error: parseFirebaseError(err) });
        rollbackTally(setTallies, id, optimistic, previous);
        setViewerState((prev) => new Map(prev).set(id, viewer));
      } finally {
        endVote(id);
      }
    },
    [viewerUid, beginVote, endVote],
  );

  // Blocked authors drop out client-side, exactly as they do for clips.
  const visible = disputes.filter((d) => !blockedUids.has(d.matcherUid) && !blockedUids.has(d.setterUid));

  return {
    disputes: visible,
    loading,
    error,
    tallyFor: (disputeId) => tallies.get(disputeId) ?? ZERO_TALLY,
    viewerFor: (disputeId) => viewerState.get(disputeId) ?? UNKNOWN_VIEWER,
    isVoting: (disputeId) => votingIds.has(disputeId),
    reload: () => void load(),
    handleVerdict,
  };
}

/**
 * Restore `previous` only if the entry still holds the value we optimistically
 * wrote — if a reload replaced it with an authoritative snapshot mid-flight,
 * rolling back would regress the UI past what the server has since said.
 */
function rollbackTally(
  setState: React.Dispatch<React.SetStateAction<ReadonlyMap<string, DisputeTally>>>,
  disputeId: string,
  optimistic: DisputeTally,
  previous: DisputeTally,
): void {
  setState((prev) => {
    const current = prev.get(disputeId);
    if (!current || current.land !== optimistic.land || current.bail !== optimistic.bail) return prev;
    return new Map(prev).set(disputeId, previous);
  });
}
