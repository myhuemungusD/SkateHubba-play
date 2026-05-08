import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlreadyUpvotedError,
  fetchClipUpvoteState,
  fetchClipsFeed,
  upvoteClip,
  type ClipDoc,
  type ClipUpvoteState,
  type ClipsFeedSort,
} from "../../services/clips";
import { trackEvent } from "../../services/analytics";
import { logger } from "../../services/logger";
import { parseFirebaseError } from "../../utils/helpers";
import { useBlockedUsers } from "../../hooks/useBlockedUsers";
import { ReportModal } from "../ReportModal";
import type { UserProfile } from "../../services/users";
import { ClipsFeedEmpty, ClipsFeedError, ClipsFeedSkeleton } from "./ClipsFeedStates";
import { ClipsFeedHeader } from "./ClipsFeedHeader";
import { NextClipPrefetcher } from "./NextClipPrefetcher";
import { SpotlightCard } from "./SpotlightCard";
import { copyForError, errorCodeFor } from "./utils";

const PAGE_SIZE = 12;

export interface ClipsFeedProps {
  profile: UserProfile;
  /** Navigate to a player's public profile. */
  onViewPlayer: (uid: string) => void;
  /** Kick off a challenge flow against a username — used by the "Challenge" CTA. */
  onChallengeUser: (username: string) => void;
}

/**
 * Community clips spotlight, embedded inside the Lobby.
 *
 * Shows one landed-trick clip at a time, ordered by `sort` (Top by default —
 * `upvoteCount` desc with most-recent as tiebreak; or New — reverse-chrono).
 * The video plays through once (no loop, no auto-advance); when it ends, the
 * viewer picks REPLAY or NEXT TRICK. Upvote, challenge-user, and report
 * controls stay visible on the action row below the video.
 *
 * Page is refetched transparently when the viewer exhausts it with NEXT
 * TRICK or flips the Top/New toggle.
 */
export function ClipsFeed({ profile, onViewPlayer, onChallengeUser }: ClipsFeedProps) {
  const [sort, setSort] = useState<ClipsFeedSort>("top");
  const [pool, setPool] = useState<ClipDoc[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<ClipDoc | null>(null);
  const [reportedClipIds, setReportedClipIds] = useState<ReadonlySet<string>>(new Set());
  const [upvoteState, setUpvoteState] = useState<ReadonlyMap<string, ClipUpvoteState>>(new Map());
  const [upvotingIds, setUpvotingIds] = useState<ReadonlySet<string>>(new Set());

  const blockedUids = useBlockedUsers(profile.uid);

  // Guard against setState-after-unmount during fetch races.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Mirror `upvotingIds` and `upvoteState` in refs so handlers can read
  // their latest values without listing them as useCallback deps. Keeping
  // these out of the deps is what lets React.memo on SpotlightCard /
  // ClipActions actually skip renders — a callback identity that flips on
  // every map mutation would defeat the memo and cascade into the video
  // subtree on every upvote tap.
  const upvotingIdsRef = useRef<ReadonlySet<string>>(upvotingIds);
  useEffect(() => {
    upvotingIdsRef.current = upvotingIds;
  }, [upvotingIds]);
  const upvoteStateRef = useRef<ReadonlyMap<string, ClipUpvoteState>>(upvoteState);
  useEffect(() => {
    upvoteStateRef.current = upvoteState;
  }, [upvoteState]);
  // sortRef lets handleUpvote tag analytics with the active sort without
  // rebuilding the callback when the user toggles Top/New.
  const sortRef = useRef<ClipsFeedSort>(sort);
  useEffect(() => {
    sortRef.current = sort;
  }, [sort]);

  // Hydrate upvote state for a freshly-loaded pool. The service reads the
  // denormalized `upvoteCount` directly off the clip docs and batches the
  // viewer's vote-doc check into a single `where(__name__, in, [...])`
  // query — at PAGE_SIZE=12 this is 1 read total instead of 24. Own clips
  // are filtered inside the service since self-upvote is rule-rejected.
  // Best-effort: page-wide failure leaves the seeded count + not-upvoted
  // state in place so the UI still renders accurate vote counts.
  const hydrateUpvotes = useCallback(
    async (pageClips: readonly ClipDoc[]) => {
      if (pageClips.length === 0) return;
      try {
        const map = await fetchClipUpvoteState(profile.uid, pageClips);
        if (!mountedRef.current) return;
        setUpvoteState((prev) => {
          const next = new Map(prev);
          for (const [id, state] of map) {
            // Race guard: don't clobber an optimistic upvote with the
            // pre-vote hydrated snapshot.
            const existing = prev.get(id);
            if (existing?.alreadyUpvoted || upvotingIdsRef.current.has(id)) continue;
            next.set(id, state);
          }
          return next;
        });
      } catch (err) {
        logger.warn("clips_feed_upvote_hydrate_failed", { error: parseFirebaseError(err) });
      }
    },
    [profile.uid],
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
      // upvote counts pop in once the batch resolves.
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

  // Filter blocked users + reported clips out on the client.
  const visibleClips = useMemo(
    () => pool.filter((c) => !blockedUids.has(c.playerUid) && !reportedClipIds.has(c.id)),
    [pool, blockedUids, reportedClipIds],
  );

  const safeIndex = visibleClips.length === 0 ? 0 : Math.min(currentIndex, visibleClips.length - 1);
  const currentClip = visibleClips[safeIndex];
  // The clip the viewer will see if they tap NEXT TRICK. We hand its URL
  // to NextClipPrefetcher so the bytes start arriving in browser cache
  // while the current clip is still playing.
  const nextClip = safeIndex + 1 < visibleClips.length ? visibleClips[safeIndex + 1] : null;

  const handleNext = useCallback(() => {
    if (safeIndex + 1 >= visibleClips.length) {
      // Page exhausted — refetch with the current sort.
      void loadPool();
      return;
    }
    setCurrentIndex(safeIndex + 1);
  }, [safeIndex, visibleClips.length, loadPool]);

  const handleUpvote = useCallback(
    async (clip: ClipDoc) => {
      if (clip.playerUid === profile.uid) return;
      // Read the latest state from refs so this callback's identity stays
      // stable across upvote-map / upvotingIds mutations. Otherwise every
      // tap would re-create the function and bust SpotlightCard's memo.
      const current = upvoteStateRef.current.get(clip.id) ?? { count: 0, alreadyUpvoted: false };
      if (current.alreadyUpvoted || upvotingIdsRef.current.has(clip.id)) return;

      setUpvotingIds((prev) => {
        const next = new Set(prev);
        next.add(clip.id);
        return next;
      });
      setUpvoteState((prev) => {
        const next = new Map(prev);
        next.set(clip.id, { count: current.count + 1, alreadyUpvoted: true });
        return next;
      });

      try {
        const nextCount = await upvoteClip(profile.uid, clip.id);
        if (!mountedRef.current) return;
        // Fire on success so AlreadyUpvotedError replays don't double-count.
        // trackEvent is consent-gated inside services/analytics — callers
        // don't need to gate again.
        trackEvent("clip_upvoted", { clipId: clip.id, fromSort: sortRef.current, newCount: nextCount });
        setUpvoteState((prev) => {
          const next = new Map(prev);
          next.set(clip.id, { count: nextCount, alreadyUpvoted: true });
          return next;
        });
      } catch (err) {
        if (err instanceof AlreadyUpvotedError) return;
        logger.warn("clips_feed_upvote_failed", { clipId: clip.id, error: parseFirebaseError(err) });
        if (!mountedRef.current) return;
        setUpvoteState((prev) => {
          const next = new Map(prev);
          next.set(clip.id, current);
          return next;
        });
      } finally {
        if (mountedRef.current) {
          setUpvotingIds((prev) => {
            const next = new Set(prev);
            next.delete(clip.id);
            return next;
          });
        }
      }
    },
    [profile.uid],
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

  const isOwnClip = currentClip ? currentClip.playerUid === profile.uid : false;
  const upvote: ClipUpvoteState = currentClip
    ? (upvoteState.get(currentClip.id) ?? { count: 0, alreadyUpvoted: false })
    : { count: 0, alreadyUpvoted: false };
  const isUpvoting = currentClip ? upvotingIds.has(currentClip.id) : false;
  const upvoteDisabled = isOwnClip || upvote.alreadyUpvoted || isUpvoting;

  return (
    <section className="mb-6" aria-label="Community feed">
      <ClipsFeedHeader
        sort={sort}
        onSortChange={handleSortChange}
        // Lock the toggle during a load so rapid taps don't queue concurrent
        // fetches (the latest would still win, but it wastes reads + flickers).
        disabled={loading}
        position={visibleClips.length > 0 ? { index: safeIndex, total: visibleClips.length } : undefined}
      />

      {error && !loading && <ClipsFeedError error={error} errorCode={errorCode} onRetry={loadPool} />}

      {loading && <ClipsFeedSkeleton />}

      {!loading && !error && !currentClip && <ClipsFeedEmpty />}

      {!loading && currentClip && (
        <>
          <SpotlightCard
            clip={currentClip}
            isOwnClip={isOwnClip}
            upvote={upvote}
            upvoteDisabled={upvoteDisabled}
            onViewPlayer={onViewPlayer}
            onNext={handleNext}
            onUpvote={handleUpvote}
            onChallenge={onChallengeUser}
            onReport={setReportTarget}
          />
          {/* Warm the cache for the upcoming clip while the current one
              plays — NEXT TRICK feels instant when the bytes are already
              local. Gated on Data-Saver / 2g inside the prefetcher. */}
          <NextClipPrefetcher src={nextClip?.videoUrl ?? null} />
        </>
      )}

      {/* Report modal */}
      {reportTarget && (
        <ReportModal
          reporterUid={profile.uid}
          reportedUid={reportTarget.playerUid}
          reportedUsername={reportTarget.playerUsername}
          gameId={reportTarget.gameId}
          clipId={reportTarget.id}
          onClose={() => setReportTarget(null)}
          onSubmitted={() => {
            const reportedId = reportTarget.id;
            setReportedClipIds((prev) => {
              const next = new Set(prev);
              next.add(reportedId);
              return next;
            });
            setReportTarget(null);
          }}
        />
      )}
    </section>
  );
}
