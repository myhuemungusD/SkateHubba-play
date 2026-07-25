/**
 * State + write orchestration for the community-clips lane of the feed.
 *
 * Extracted from ClipsFeed/index.tsx so the component stays close to the
 * 250 LOC budget once the ruling lane landed alongside it. Mirrors the
 * `useLobbyController` pattern: all state and handlers here, JSX there.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlreadyUpvotedError,
  NotUpvotedError,
  fetchClipUpvoteState,
  fetchClipsFeed,
  removeUpvote,
  upvoteClip,
  type ClipDoc,
  type ClipUpvoteState,
  type ClipsFeedSort,
} from "../../services/clips";
import { trackEvent } from "../../services/analytics";
import { logger } from "../../services/logger";
import { parseFirebaseError } from "../../utils/helpers";
import { useBlockedUsers } from "../../hooks/useBlockedUsers";
import { copyForError, errorCodeFor } from "./utils";

const PAGE_SIZE = 12;

const NO_VOTE: ClipUpvoteState = { count: 0, alreadyUpvoted: false };

export function useClipsFeedController(viewerUid: string) {
  const [sort, setSort] = useState<ClipsFeedSort>("top");
  const [pool, setPool] = useState<ClipDoc[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // Clips removed from THIS session's feed: reported (hidden immediately so
  // the reporter stops seeing the content) or thumbed down (passed).
  const [dismissedClipIds, setDismissedClipIds] = useState<ReadonlySet<string>>(new Set());
  const [upvoteState, setUpvoteState] = useState<ReadonlyMap<string, ClipUpvoteState>>(new Map());
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
  const upvoteStateRef = useRef<ReadonlyMap<string, ClipUpvoteState>>(upvoteState);
  useEffect(() => {
    upvoteStateRef.current = upvoteState;
  }, [upvoteState]);
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
   * Hydrate upvote state for a freshly-loaded pool. The service reads the
   * denormalized `upvoteCount` off the clip docs and batches the viewer's
   * vote-doc check into a single `where(__name__, in, [...])` query — at
   * PAGE_SIZE=12 that is 1 read total. Own clips are filtered inside the
   * service since self-upvote is rejected there.
   *
   * Best-effort: a page-wide failure leaves the seeded count + not-upvoted
   * state in place so the UI still renders accurate vote counts.
   */
  const hydrateUpvotes = useCallback(
    async (pageClips: readonly ClipDoc[]) => {
      if (pageClips.length === 0) return;
      try {
        const map = await fetchClipUpvoteState(viewerUid, pageClips);
        if (!mountedRef.current) return;
        setUpvoteState((prev) => {
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
        logger.warn("clips_feed_upvote_hydrate_failed", { error: parseFirebaseError(err) });
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
      void hydrateUpvotes(page.clips);
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
  }, [hydrateUpvotes, sort]);

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

  const handleUpvote = useCallback(
    async (clip: ClipDoc) => {
      if (clip.playerUid === viewerUid) return;
      // Read the latest state from refs so this callback's identity stays
      // stable across vote-map / votingIds mutations.
      const current = upvoteStateRef.current.get(clip.id) ?? NO_VOTE;
      if (current.alreadyUpvoted || votingIdsRef.current.has(clip.id)) return;

      beginVote(clip.id);
      const optimistic: ClipUpvoteState = { count: current.count + 1, alreadyUpvoted: true };
      setUpvoteState((prev) => new Map(prev).set(clip.id, optimistic));

      try {
        const nextCount = await upvoteClip(viewerUid, clip.id);
        if (!mountedRef.current) return;
        // Fire on success so AlreadyUpvotedError replays don't double-count.
        // trackEvent is consent-gated inside services/analytics.
        trackEvent("clip_upvoted", { clipId: clip.id, fromSort: sortRef.current, newCount: nextCount });
        setUpvoteState((prev) => new Map(prev).set(clip.id, { count: nextCount, alreadyUpvoted: true }));
      } catch (err) {
        // Already-upvoted means the server agrees with our optimistic state.
        if (err instanceof AlreadyUpvotedError) return;
        logger.warn("clips_feed_upvote_failed", { clipId: clip.id, error: parseFirebaseError(err) });
        if (!mountedRef.current) return;
        rollback(setUpvoteState, clip.id, optimistic, current);
      } finally {
        endVote(clip.id);
      }
    },
    [viewerUid, beginVote, endVote],
  );

  /**
   * Thumbs down: always drops the clip from this session's feed, and — when
   * the viewer had previously thumbed it up — withdraws that vote server-side
   * via `removeUpvote`. There is no negative tally in the data model, so this
   * is "take it back / not for me", not a dislike counter.
   */
  const handleDownvote = useCallback(
    async (clip: ClipDoc) => {
      if (clip.playerUid === viewerUid) return;
      if (votingIdsRef.current.has(clip.id)) return;

      const current = upvoteStateRef.current.get(clip.id) ?? NO_VOTE;
      // Dismiss first: the clip leaves the feed on this tap either way, and
      // doing it up front keeps the UI responsive while the write is in
      // flight. `visibleClips` recomputes, so the next clip slides in.
      dismissClip(clip.id);

      if (!current.alreadyUpvoted) {
        trackEvent("clip_passed", { clipId: clip.id, fromSort: sortRef.current });
        return;
      }

      beginVote(clip.id);
      const optimistic: ClipUpvoteState = { count: Math.max(0, current.count - 1), alreadyUpvoted: false };
      setUpvoteState((prev) => new Map(prev).set(clip.id, optimistic));

      try {
        const nextCount = await removeUpvote(viewerUid, clip.id);
        if (!mountedRef.current) return;
        trackEvent("clip_upvote_withdrawn", { clipId: clip.id, fromSort: sortRef.current, newCount: nextCount });
        setUpvoteState((prev) => new Map(prev).set(clip.id, { count: nextCount, alreadyUpvoted: false }));
      } catch (err) {
        // No vote to withdraw — the server already agrees with our state.
        if (err instanceof NotUpvotedError) return;
        logger.warn("clips_feed_downvote_failed", { clipId: clip.id, error: parseFirebaseError(err) });
        if (!mountedRef.current) return;
        rollback(setUpvoteState, clip.id, optimistic, current);
      } finally {
        endVote(clip.id);
      }
    },
    [viewerUid, beginVote, endVote, dismissClip],
  );

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
    upvoteFor: (clipId: string) => upvoteState.get(clipId) ?? NO_VOTE,
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
  setState: React.Dispatch<React.SetStateAction<ReadonlyMap<string, ClipUpvoteState>>>,
  clipId: string,
  optimistic: ClipUpvoteState,
  previous: ClipUpvoteState,
): void {
  setState((prev) => {
    const cur = prev.get(clipId);
    if (!cur || cur.count !== optimistic.count || cur.alreadyUpvoted !== optimistic.alreadyUpvoted) {
      return prev;
    }
    return new Map(prev).set(clipId, previous);
  });
}
