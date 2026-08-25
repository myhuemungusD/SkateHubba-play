/**
 * State + write orchestration for the community-clips lane of the feed.
 *
 * Extracted from ClipsFeed/index.tsx so the component stays close to the
 * 250 LOC budget once the ruling lane landed alongside it. Mirrors the
 * `useLobbyController` pattern: all state and handlers here, JSX there.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchClipsFeed, type ClipDoc, type ClipsFeedSort } from "../../services/clips";
import { fetchClipVoteState, removeClipVote, voteClip, type ClipVoteState } from "../../services/clips.upvotes";
import { trackEvent } from "../../services/analytics";
import { logger } from "../../services/logger";
import { parseFirebaseError } from "../../utils/helpers";
import { useBlockedUsers } from "../../hooks/useBlockedUsers";
import { NO_VOTE, applyVote, nextVoteFor, sameVoteState, type VoteValue } from "./clipVoteMath";
import { copyForError, errorCodeFor } from "./utils";

const PAGE_SIZE = 12;

export function useClipsFeedController(viewerUid: string) {
  const [sort, setSort] = useState<ClipsFeedSort>("top");
  const [pool, setPool] = useState<ClipDoc[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // Clips removed from THIS session's feed. Reporting is now the only thing
  // that does this — a thumbs down is a rating the clip carries, not a "hide
  // it from me", so it deliberately leaves the clip in place.
  const [dismissedClipIds, setDismissedClipIds] = useState<ReadonlySet<string>>(new Set());
  const [voteState, setVoteState] = useState<ReadonlyMap<string, ClipVoteState>>(new Map());
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

  // Mirror `votingIds` and `upvoteState` in refs so handlers can read their
  // latest values without listing them as useCallback deps. Keeping these
  // out of the deps is what lets React.memo on SpotlightCard / ClipActions
  // actually skip renders — a callback identity that flips on every map
  // mutation would defeat the memo and cascade into the video subtree on
  // every vote tap.
  const votingIdsRef = useRef<ReadonlySet<string>>(votingIds);
  useEffect(() => {
    votingIdsRef.current = votingIds;
  }, [votingIds]);
  const voteStateRef = useRef<ReadonlyMap<string, ClipVoteState>>(voteState);
  useEffect(() => {
    voteStateRef.current = voteState;
  }, [voteState]);
  // sortRef lets the vote handlers tag analytics with the active sort
  // without rebuilding the callbacks when the user toggles Top/New.
  const sortRef = useRef<ClipsFeedSort>(sort);
  useEffect(() => {
    sortRef.current = sort;
  }, [sort]);

  const beginVote = useCallback((clipId: string) => {
    setVotingIds((prev) => {
      const next = new Set(prev);
      next.add(clipId);
      return next;
    });
  }, []);

  const endVote = useCallback((clipId: string) => {
    if (!mountedRef.current) return;
    setVotingIds((prev) => {
      const next = new Set(prev);
      next.delete(clipId);
      return next;
    });
  }, []);

  /**
   * Hydrate vote state for a freshly-loaded pool. The service reads the
   * denormalized `upvoteCount` / `downvoteCount` off the clip docs and batches
   * the viewer's vote-doc check into a single `where(__name__, in, [...])`
   * query — at PAGE_SIZE=12 that is 1 read total.
   *
   * Best-effort: a page-wide failure leaves the seeded counts and a null
   * `myVote` in place, so the tallies still render and only the viewer's own
   * highlight is missing.
   */
  const hydrateVotes = useCallback(
    async (pageClips: readonly ClipDoc[]) => {
      if (pageClips.length === 0) return;
      try {
        const map = await fetchClipVoteState(viewerUid, pageClips);
        if (!mountedRef.current) return;
        setVoteState((prev) => {
          const next = new Map(prev);
          for (const [id, state] of map) {
            // Race guard: don't clobber an in-flight optimistic vote with the
            // pre-write hydrated snapshot.
            if (votingIdsRef.current.has(id)) continue;
            next.set(id, state);
          }
          return next;
        });
      } catch (err) {
        logger.warn("clips_feed_vote_hydrate_failed", { error: parseFirebaseError(err) });
      }
    },
    [viewerUid],
  );

  const loadPool = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const page = await fetchClipsFeed(null, PAGE_SIZE, sort);
      if (!mountedRef.current) return;
      setPool(page.clips);
      setCurrentIndex(0);
      // Hydration is fire-and-forget — spotlight renders immediately,
      // vote counts pop in once the batch resolves.
      void hydrateVotes(page.clips);
    } catch (err) {
      const code = errorCodeFor(err);
      logger.warn("clips_feed_load_failed", { code, error: parseFirebaseError(err) });
      if (mountedRef.current) {
        setError(copyForError(code));
        setErrorCode(code ?? null);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [hydrateVotes, sort]);

  useEffect(() => {
    loadPool();
  }, [loadPool]);

  // Filter blocked users + session-dismissed clips out on the client.
  const visibleClips = useMemo(
    () => pool.filter((c) => !blockedUids.has(c.playerUid) && !dismissedClipIds.has(c.id)),
    [pool, blockedUids, dismissedClipIds],
  );

  const safeIndex = visibleClips.length === 0 ? 0 : Math.min(currentIndex, visibleClips.length - 1);
  const currentClip = visibleClips[safeIndex];
  // The clip the viewer will see next. We hand its URL to NextClipPrefetcher
  // so the bytes start arriving while the current clip is still playing.
  const nextClip = safeIndex + 1 < visibleClips.length ? visibleClips[safeIndex + 1] : null;

  // Every clip in the page was blocked, reported, or thumbed down. Distinct
  // from "no clips exist" — the copy and the affordance differ.
  const exhausted = !loading && !error && pool.length > 0 && visibleClips.length === 0;

  const handleNext = useCallback(() => {
    if (safeIndex + 1 >= visibleClips.length) {
      // Page exhausted — refetch with the current sort.
      void loadPool();
      return;
    }
    setCurrentIndex(safeIndex + 1);
  }, [safeIndex, visibleClips.length, loadPool]);

  const dismissClip = useCallback((clipId: string) => {
    setDismissedClipIds((prev) => {
      const next = new Set(prev);
      next.add(clipId);
      return next;
    });
  }, []);

  /**
   * Cast, flip, or withdraw a vote.
   *
   * Both thumbs are toggles over the same single vote doc, so they share one
   * handler: tapping the thumb you already gave withdraws it, tapping the
   * other flips it. A downvote is a real, persisted negative tally now — it
   * does NOT hide the clip. Passing on a clip is what NEXT TRICK is for, and
   * conflating the two meant a viewer who wanted to register "that was not a
   * make" also lost the clip they were about to comment on.
   *
   * Self-votes are rejected here as well as in the UI: `isOwnClip` disables
   * the controls, but the handler is the guard that survives a stale prop.
   */
  const castVote = useCallback(
    async (clip: ClipDoc, pressed: 1 | -1) => {
      if (clip.playerUid === viewerUid) return;
      // Read the latest state from refs so this callback's identity stays
      // stable across vote-map / votingIds mutations.
      if (votingIdsRef.current.has(clip.id)) return;
      const current = voteStateRef.current.get(clip.id) ?? NO_VOTE;
      const next: VoteValue = nextVoteFor(current, pressed);

      beginVote(clip.id);
      const optimistic = applyVote(current, next);
      setVoteState((prev) => new Map(prev).set(clip.id, optimistic));

      try {
        const confirmed =
          next === null ? await removeClipVote(viewerUid, clip.id) : await voteClip(viewerUid, clip.id, next);
        if (!mountedRef.current) return;
        // Fire on success so a retried write can't double-count. trackEvent is
        // consent-gated inside services/analytics.
        trackEvent("clip_voted", { clipId: clip.id, fromSort: sortRef.current, vote: next ?? 0 });
        setVoteState((prev) => new Map(prev).set(clip.id, confirmed));
      } catch (err) {
        logger.warn("clips_feed_vote_failed", { clipId: clip.id, vote: next ?? 0, error: parseFirebaseError(err) });
        if (!mountedRef.current) return;
        rollback(setVoteState, clip.id, optimistic, current);
      } finally {
        endVote(clip.id);
      }
    },
    [viewerUid, beginVote, endVote],
  );

  const handleUpvote = useCallback((clip: ClipDoc) => castVote(clip, 1), [castVote]);
  const handleDownvote = useCallback((clip: ClipDoc) => castVote(clip, -1), [castVote]);

  const handleSortChange = useCallback(
    (next: ClipsFeedSort) => {
      if (next === sort) return;
      // Track engagement with the toggle itself — clip_upvoted.fromSort tells
      // us where votes happen, this tells us whether viewers actually toggle.
      trackEvent("clips_sort_changed", { from: sort, to: next });
      setSort(next);
    },
    [sort],
  );

  return {
    sort,
    loading,
    error,
    errorCode,
    visibleClips,
    currentClip,
    nextClip,
    safeIndex,
    exhausted,
    voteFor: (clipId: string) => voteState.get(clipId) ?? NO_VOTE,
    isVoting: (clipId: string) => votingIds.has(clipId),
    loadPool,
    handleNext,
    handleUpvote,
    handleDownvote,
    handleSortChange,
    dismissClip,
  };
}

/**
 * Restore `previous` only if the entry still holds the value we optimistically
 * wrote. If a re-hydration replaced it with an authoritative server snapshot
 * mid-flight, leave it alone — rolling back would regress the UI to a value
 * the server has since moved past.
 */
function rollback(
  setState: React.Dispatch<React.SetStateAction<ReadonlyMap<string, ClipVoteState>>>,
  clipId: string,
  optimistic: ClipVoteState,
  previous: ClipVoteState,
): void {
  setState((prev) => {
    const cur = prev.get(clipId);
    if (!cur || !sameVoteState(cur, optimistic)) return prev;
    return new Map(prev).set(clipId, previous);
  });
}
