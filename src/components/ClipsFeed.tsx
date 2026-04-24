import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlreadyUpvotedError,
  fetchClipUpvoteState,
  fetchRandomLandedClips,
  upvoteClip,
  type ClipDoc,
  type ClipUpvoteState,
} from "../services/clips";
import { logger } from "../services/logger";
import { parseFirebaseError } from "../utils/helpers";
import { useBlockedUsers } from "../hooks/useBlockedUsers";
import { ReportModal } from "./ReportModal";
import { Btn } from "./ui/Btn";
import { FilmIcon, FlameIcon, ChevronRightIcon, FlagIcon } from "./icons";
import { ProUsername } from "./ProUsername";
import type { UserProfile } from "../services/users";

const SAMPLE_SIZE = 12;
const POOL_SIZE = 60;

/** Firestore error codes that map to "service-side issue, not your network". */
const SERVICE_ERROR_CODES = new Set(["permission-denied", "failed-precondition", "unauthenticated"]);

function errorCodeFor(err: unknown): string | undefined {
  return typeof err === "object" && err && typeof (err as { code?: unknown }).code === "string"
    ? (err as { code: string }).code
    : undefined;
}

function copyForError(code: string | undefined): string {
  if (code && SERVICE_ERROR_CODES.has(code)) {
    return "Feed temporarily unavailable — please try again in a moment.";
  }
  return "Couldn't load the feed. Check your connection and try again.";
}

/** Human-readable "2m ago" / "3h ago" / "Apr 12" timestamp. */
function relativeClipTime(createdAt: ClipDoc["createdAt"]): string {
  if (!createdAt || typeof createdAt.toMillis !== "function") return "";
  const millis = createdAt.toMillis();
  const deltaMs = Date.now() - millis;
  if (deltaMs < 0) return "just now";
  const minutes = deltaMs / 60_000;
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)}d ago`;
  const d = new Date(millis);
  const month = d.toLocaleString("en-US", { month: "short" });
  return `${month} ${d.getDate()}`;
}

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

      {/* Error */}
      {error && !loading && (
        <div className="glass-card rounded-2xl p-5 mb-3 border border-brand-red/30">
          <p className="font-body text-sm text-white/80 mb-3">{error}</p>
          {errorCode && import.meta.env.DEV && (
            <p className="font-body text-[10px] text-faint mb-3">code: {errorCode}</p>
          )}
          <Btn onClick={loadPool} variant="secondary">
            Try again
          </Btn>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div
          className="glass-card rounded-2xl overflow-hidden animate-pulse"
          role="status"
          aria-busy="true"
          aria-label="Loading clips"
        >
          <div className="flex items-center justify-between px-4 pt-3.5 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-surface-alt border border-border" />
              <div className="h-3 w-20 rounded-md bg-surface-alt" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 w-10 rounded-md bg-surface-alt" />
              <div className="h-3 w-12 rounded-md bg-surface-alt/70" />
            </div>
          </div>
          <div className="px-4">
            <div className="w-full aspect-[9/16] max-h-[560px] rounded-xl bg-surface-alt border border-border" />
          </div>
          <div className="px-4 pt-3">
            <div className="h-5 w-40 rounded-md bg-surface-alt" />
          </div>
          <div className="px-4 pt-3 pb-4 flex items-center gap-2">
            <div className="h-11 w-16 rounded-xl bg-surface-alt" />
            <div className="h-11 flex-1 rounded-xl bg-surface-alt" />
            <div className="h-11 w-20 rounded-xl bg-surface-alt" />
          </div>
          <span className="sr-only">Loading feed…</span>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && !currentClip && (
        <div className="flex flex-col items-center py-10 border border-dashed border-white/[0.06] rounded-2xl bg-surface/30">
          <FilmIcon size={24} className="mb-3 text-faint" />
          <p className="font-body text-sm text-dim">No clips yet.</p>
          <p className="font-body text-xs text-faint mt-1">Land a trick to start filling the feed.</p>
        </div>
      )}

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
          <div className="px-4 pt-3 pb-4 flex items-center gap-2">
            {!isOwnClip && (
              <button
                type="button"
                onClick={() => handleUpvote(currentClip)}
                disabled={upvoteDisabled}
                aria-pressed={upvote.alreadyUpvoted}
                aria-label={
                  upvote.alreadyUpvoted
                    ? `Upvoted · ${upvote.count}`
                    : `Upvote clip by @${currentClip.playerUsername} · current count ${upvote.count}`
                }
                className={`min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 border transition-all duration-300 ease-smooth focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed active:scale-[0.97] ${
                  upvote.alreadyUpvoted
                    ? "border-brand-orange/40 bg-brand-orange/15 text-brand-orange"
                    : "border-border bg-surface/60 text-white/90 hover:border-brand-orange/30 hover:bg-brand-orange/5"
                }`}
              >
                <FlameIcon size={14} className={upvote.alreadyUpvoted ? "text-brand-orange" : "text-brand-orange/80"} />
                <span className="font-display text-xs tracking-wider tabular-nums">{upvote.count}</span>
              </button>
            )}
            {!isOwnClip && (
              <button
                type="button"
                onClick={() => onChallengeUser(currentClip.playerUsername)}
                aria-label={`Challenge @${currentClip.playerUsername}`}
                className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl font-display text-sm tracking-wider bg-gradient-to-r from-brand-orange via-[#FF7A1A] to-[#FF8533] text-white active:scale-[0.97] hover:-translate-y-0.5 transition-all duration-300 shadow-[0_2px_12px_rgba(255,107,0,0.18)] ring-1 ring-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              >
                <span>Challenge</span>
                <ChevronRightIcon size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setReportTarget(currentClip)}
              disabled={isOwnClip}
              aria-label={`Report clip by @${currentClip.playerUsername}`}
              className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 font-display text-[11px] tracking-[0.15em] text-faint border border-border hover:text-white hover:border-border-hover hover:bg-white/[0.02] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            >
              <FlagIcon size={13} />
              REPORT
            </button>
          </div>
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

/**
 * Single-clip video with tap-to-unmute and a Replay / Next Trick overlay on end.
 *
 * Autoplays muted once (no loop, no auto-advance). Pauses when scrolled out of
 * the viewport — but only AFTER the first play() has resolved, because mobile
 * Safari revokes the muted-autoplay grant if pause() runs too early, which
 * surfaces as "feed loaded but clip won't play".
 */
function SpotlightVideo({ src, onNext }: { src: string; onNext: () => void }) {
  const [muted, setMuted] = useState(true);
  const [ended, setEnded] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasPlayedRef = useRef(false);

  const handlePlay = useCallback(() => {
    hasPlayedRef.current = true;
    setEnded(false);
  }, []);

  const handleEnded = useCallback(() => {
    setEnded(true);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      const el = videoRef.current;
      if (el) el.muted = next;
      return next;
    });
  }, []);

  const handleReplay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = 0;
    setEnded(false);
    el.play().catch(() => undefined);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          video
            .play()
            .then(() => {
              hasPlayedRef.current = true;
            })
            .catch(() => undefined);
        } else if (hasPlayedRef.current) {
          // Gate with hasPlayedRef: an early pause revokes the muted-autoplay
          // grant on mobile Safari, which breaks every subsequent play().
          video.pause();
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative rounded-xl overflow-hidden border border-border">
      <video
        ref={videoRef}
        src={src}
        autoPlay
        muted
        playsInline
        preload="metadata"
        onPlay={handlePlay}
        onEnded={handleEnded}
        className="w-full aspect-[9/16] max-h-[560px] bg-black object-cover"
      />

      {/* Tap-to-unmute overlay. Hidden once the clip ends so the Replay /
          Next Trick overlay below can receive taps. */}
      {!ended && (
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute clip" : "Mute clip"}
          className="absolute inset-0 z-10 w-full h-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          {muted && (
            <span
              aria-hidden="true"
              className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] font-display tracking-[0.2em] text-white backdrop-blur"
            >
              MUTED · TAP
            </span>
          )}
        </button>
      )}

      {/* End-of-clip prompt: REPLAY or NEXT TRICK. */}
      {ended && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm p-4">
          <p className="font-display text-[11px] tracking-[0.2em] text-white/70">Clip ended</p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleReplay}
              aria-label="Replay clip"
              className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl px-5 border border-border bg-surface/80 text-white/90 font-display text-sm tracking-wider hover:bg-white/[0.04] active:scale-[0.97] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            >
              REPLAY
            </button>
            <button
              type="button"
              onClick={onNext}
              aria-label="Next trick"
              className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl px-5 font-display text-sm tracking-wider bg-gradient-to-r from-brand-orange via-[#FF7A1A] to-[#FF8533] text-white active:scale-[0.97] hover:-translate-y-0.5 transition-all shadow-[0_2px_12px_rgba(255,107,0,0.18)] ring-1 ring-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            >
              NEXT TRICK
              <ChevronRightIcon size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
