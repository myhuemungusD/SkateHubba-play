import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlreadyUpvotedError,
  fetchClipUpvoteState,
  fetchRandomLandedClips,
  upvoteClip,
  type ClipDoc,
  type ClipUpvoteState,
} from "../../services/clips";
import { logger } from "../../services/logger";
import { parseFirebaseError } from "../../utils/helpers";
import { useBlockedUsers } from "../../hooks/useBlockedUsers";
import { ReportModal } from "../ReportModal";
import { ProUsername } from "../ProUsername";
import type { UserProfile } from "../../services/users";
import { ClipActions } from "./ClipActions";
import { ClipsFeedEmpty, ClipsFeedError, ClipsFeedSkeleton } from "./ClipsFeedStates";
import { SpotlightVideo } from "./SpotlightVideo";
import { copyForError, errorCodeFor, relativeClipTime } from "./utils";

const SAMPLE_SIZE = 12;
const POOL_SIZE = 60;

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
 * Shows one random landed-trick clip at a time. The video plays through once
 * (no loop, no auto-advance); when it ends, the viewer picks REPLAY or
 * NEXT TRICK. Upvote, challenge-user, and report controls stay visible on
 * the action row below the video.
 *
 * Random pool is refetched (and reshuffled) transparently when the viewer
 * exhausts it with NEXT TRICK.
 */
export function ClipsFeed({ profile, onViewPlayer, onChallengeUser }: ClipsFeedProps) {
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

  // Mirror `upvotingIds` in a ref so hydration can see it without being
  // re-memoized on every tap (which would retrigger hydration).
  const upvotingIdsRef = useRef<ReadonlySet<string>>(upvotingIds);
  useEffect(() => {
    upvotingIdsRef.current = upvotingIds;
  }, [upvotingIds]);

  // Hydrate upvote state for a freshly-loaded pool. Best-effort: failures
  // leave entries missing (UI defaults to count=0, not-upvoted). Own clips
  // are skipped because self-upvote is disallowed.
  const hydrateUpvotes = useCallback(
    async (pageClips: readonly ClipDoc[]) => {
      const ids = pageClips.filter((c) => c.playerUid !== profile.uid).map((c) => c.id);
      if (ids.length === 0) return;
      try {
        const map = await fetchClipUpvoteState(profile.uid, ids);
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
      const fresh = await fetchRandomLandedClips(SAMPLE_SIZE, POOL_SIZE);
      if (!mountedRef.current) return;
      setPool(fresh);
      setCurrentIndex(0);
      // Hydration is fire-and-forget — spotlight renders immediately,
      // upvote counts pop in once the batch resolves.
      void hydrateUpvotes(fresh);
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
  }, [hydrateUpvotes]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadPool is async (awaits Firestore before setState), not a synchronous setState
    loadPool();
  }, [loadPool]);

  // Filter blocked users + reported clips out on the client.
  const visibleClips = useMemo(
    () => pool.filter((c) => !blockedUids.has(c.playerUid) && !reportedClipIds.has(c.id)),
    [pool, blockedUids, reportedClipIds],
  );

  const safeIndex = visibleClips.length === 0 ? 0 : Math.min(currentIndex, visibleClips.length - 1);
  const currentClip = visibleClips[safeIndex];

  const handleNext = useCallback(() => {
    if (safeIndex + 1 >= visibleClips.length) {
      // Pool exhausted — refetch + reshuffle.
      void loadPool();
      return;
    }
    setCurrentIndex(safeIndex + 1);
  }, [safeIndex, visibleClips.length, loadPool]);

  const handleUpvote = useCallback(
    async (clip: ClipDoc) => {
      if (clip.playerUid === profile.uid) return;
      const current = upvoteState.get(clip.id) ?? { count: 0, alreadyUpvoted: false };
      if (current.alreadyUpvoted || upvotingIds.has(clip.id)) return;

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
    [profile.uid, upvoteState, upvotingIds],
  );

  const isOwnClip = currentClip ? currentClip.playerUid === profile.uid : false;
  const upvote: ClipUpvoteState = currentClip
    ? (upvoteState.get(currentClip.id) ?? { count: 0, alreadyUpvoted: false })
    : { count: 0, alreadyUpvoted: false };
  const isUpvoting = currentClip ? upvotingIds.has(currentClip.id) : false;
  const upvoteDisabled = isOwnClip || upvote.alreadyUpvoted || isUpvoting;

  return (
    <section className="mb-6" aria-label="Community feed">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">FEED</h3>
        {visibleClips.length > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
            {safeIndex + 1}/{visibleClips.length}
          </span>
        )}
      </div>

      {error && !loading && <ClipsFeedError error={error} errorCode={errorCode} onRetry={loadPool} />}

      {loading && <ClipsFeedSkeleton />}

      {!loading && !error && !currentClip && <ClipsFeedEmpty />}

      {/* Spotlight clip */}
      {!loading && currentClip && (
        <article className="glass-card rounded-2xl overflow-hidden" aria-label="Current clip">
          <div className="flex items-center justify-between px-4 pt-3.5 pb-3">
            <button
              type="button"
              onClick={() => onViewPlayer(currentClip.playerUid)}
              className="flex items-center gap-2 touch-target rounded-xl px-1.5 py-1 -ml-1.5 hover:bg-white/[0.03] transition-colors duration-200 group"
            >
              <div className="w-7 h-7 rounded-full bg-brand-orange/10 border border-brand-orange/20 flex items-center justify-center shrink-0">
                <span className="font-display text-[11px] text-brand-orange leading-none">
                  {currentClip.playerUsername[0]?.toUpperCase() ?? "?"}
                </span>
              </div>
              <ProUsername
                username={currentClip.playerUsername}
                className="font-body text-xs text-white/80 group-hover:text-brand-orange transition-colors duration-200"
              />
            </button>
            <div className="flex items-center gap-2">
              <span
                className={`font-display text-[10px] tracking-[0.2em] px-2 py-0.5 rounded-md border ${
                  currentClip.role === "set"
                    ? "text-brand-orange border-brand-orange/30 bg-brand-orange/5"
                    : "text-brand-green border-brand-green/30 bg-brand-green/5"
                }`}
                aria-label={currentClip.role === "set" ? "Setter's landed trick" : "Matcher's landed response"}
              >
                {currentClip.role === "set" ? "SET" : "MATCH"}
              </span>
              <span className="font-body text-[11px] text-faint">{relativeClipTime(currentClip.createdAt)}</span>
            </div>
          </div>

          {/* Video — plays once, no loop, no auto-advance. `key={clip.id}`
              remounts (and resets ended/muted state) on every Next. */}
          <div className="px-4">
            <SpotlightVideo key={currentClip.id} src={currentClip.videoUrl} onNext={handleNext} />
          </div>

          {/* Trick name */}
          <div className="px-4 pt-3">
            <h2 className="font-display text-xl text-white tracking-wide leading-tight">{currentClip.trickName}</h2>
          </div>

          {/* Actions — vote, challenge, report stay visible always. */}
          <ClipActions
            clip={currentClip}
            isOwnClip={isOwnClip}
            upvote={upvote}
            upvoteDisabled={upvoteDisabled}
            onUpvote={handleUpvote}
            onChallenge={onChallengeUser}
            onReport={setReportTarget}
          />
        </article>
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
