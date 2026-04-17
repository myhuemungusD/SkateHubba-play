import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlreadyUpvotedError,
  fetchClipsFeed,
  fetchClipUpvoteState,
  upvoteClip,
  type ClipDoc,
  type ClipsFeedCursor,
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

const PAGE_SIZE = 12;

/** Firestore error codes that map to "service-side issue, not your network".
 *  Used to swap the misleading "check your connection" copy for something
 *  truer when the failure is permission-denied / index missing / unauthed. */
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
 * Community clips feed, embedded inside the Lobby.
 *
 * Originally lived as its own /feed screen + bottom-nav tab; consolidated into
 * the lobby so the home surface contains everything a user can do (your games,
 * skaters directory, browse clips) without a tab switch.
 */
export function ClipsFeed({ profile, onViewPlayer, onChallengeUser }: ClipsFeedProps) {
  const [clips, setClips] = useState<ClipDoc[]>([]);
  const [cursor, setCursor] = useState<ClipsFeedCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // Separate from `error`/`errorCode` so a load-more failure doesn't replace
  // the whole feed — existing clips stay visible and the error renders where
  // the Load more button was.
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [loadMoreErrorCode, setLoadMoreErrorCode] = useState<string | null>(null);
  const [endOfFeed, setEndOfFeed] = useState(false);
  const [reportTarget, setReportTarget] = useState<ClipDoc | null>(null);
  const [reportedClipIds, setReportedClipIds] = useState<ReadonlySet<string>>(new Set());
  // Per-clip upvote state, keyed by clip id. Defaults to {0,false} when
  // an entry is missing (e.g. the batch fetch failed for that page).
  const [upvoteState, setUpvoteState] = useState<ReadonlyMap<string, ClipUpvoteState>>(new Map());
  // Tracks an in-flight upvote tap so a user can't double-fire on the same
  // clip before the optimistic update settles.
  const [upvotingIds, setUpvotingIds] = useState<ReadonlySet<string>>(new Set());

  const blockedUids = useBlockedUsers(profile.uid);

  // Guard against setState-after-unmount during pagination races.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Mirror `upvotingIds` in a ref so `hydrateUpvotes` can see it without
  // being re-memoized on every tap (which would retrigger hydration).
  const upvotingIdsRef = useRef<ReadonlySet<string>>(upvotingIds);
  useEffect(() => {
    upvotingIdsRef.current = upvotingIds;
  }, [upvotingIds]);

  // Hydrate upvote state for a freshly-loaded page of clips. Best-effort:
  // failures here just leave entries missing (UI defaults to count=0,
  // not-upvoted) — never block the feed render. Own clips are skipped
  // because they can't be upvoted; no sense paying for those reads.
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
            // Race guard: if the user has already optimistically upvoted
            // (or a vote is in-flight), the hydrated pre-vote snapshot
            // would clobber their tap. Keep the user-initiated state.
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

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const page = await fetchClipsFeed(null, PAGE_SIZE);
      if (!mountedRef.current) return;
      setClips(page.clips);
      setCursor(page.cursor);
      setEndOfFeed(page.clips.length < PAGE_SIZE);
      // Hydration is fire-and-forget — feed renders immediately, upvote
      // counts pop in once the batch resolves.
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
  }, [hydrateUpvotes]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore || endOfFeed) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    setLoadMoreErrorCode(null);
    try {
      const page = await fetchClipsFeed(cursor, PAGE_SIZE);
      if (!mountedRef.current) return;
      setClips((prev) => [...prev, ...page.clips]);
      setCursor(page.cursor);
      if (page.clips.length < PAGE_SIZE) setEndOfFeed(true);
      void hydrateUpvotes(page.clips);
    } catch (err) {
      const code = errorCodeFor(err);
      logger.warn("clips_feed_loadmore_failed", { code, error: parseFirebaseError(err) });
      if (mountedRef.current) {
        setLoadMoreError(copyForError(code));
        setLoadMoreErrorCode(code ?? null);
      }
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
  }, [cursor, loadingMore, endOfFeed, hydrateUpvotes]);

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
      // Optimistic flip — feels instant, rolled back below if the write
      // fails for any reason other than AlreadyUpvotedError.
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
        if (err instanceof AlreadyUpvotedError) {
          // Server already has our vote (e.g. a second device or stale
          // local state). Optimistic state matches truth — keep it.
          return;
        }
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

  // Filter blocked users out on the client (matches how games/directory work).
  const visibleClips = useMemo(
    () => clips.filter((c) => !blockedUids.has(c.playerUid) && !reportedClipIds.has(c.id)),
    [clips, blockedUids, reportedClipIds],
  );

  // Top-of-feed rotation. The top slot auto-advances through the visible
  // landed-trick clips so the lobby always feels alive — once one clip
  // finishes, the next plays. Wraps back to the start at the end of the
  // loaded page (and tries to fetch more so the rotation can keep growing).
  //
  // Tracked by clip id rather than positional index: a positional index
  // silently points at a different clip whenever the list mutates (a clip
  // gets reported, a blocked user's clip is filtered out, pagination
  // inserts new clips). Identity tracking keeps the "currently playing"
  // clip stable across those mutations.
  //
  // `topClipId` holds the user's rotation selection; `effectiveTopClipId`
  // resolves it against the live `visibleClips` list. Deriving the
  // effective id via memo (instead of sync'ing via `useEffect`) removes
  // the render-window where state is null but the DOM is already showing
  // visibleClips[0] — that window was the source of a CI race where an
  // `ended` event arrived before the sync effect had run and rotation
  // silently no-op'd back onto the clip already playing.
  const [topClipId, setTopClipId] = useState<string | null>(null);
  const effectiveTopClipId = useMemo<string | null>(() => {
    if (visibleClips.length === 0) return null;
    if (topClipId && visibleClips.some((c) => c.id === topClipId)) return topClipId;
    return visibleClips[0].id;
  }, [visibleClips, topClipId]);

  const advanceTopClip = useCallback(() => {
    if (visibleClips.length === 0) return;
    setTopClipId((current) => {
      // Resolve the "current" selection the same way the DOM does via
      // `effectiveTopClipId` — a stale or null `current` still maps to
      // visibleClips[0], so advancing always moves forward by one slot.
      const resolved = current && visibleClips.some((c) => c.id === current) ? current : visibleClips[0].id;
      const currentIndex = visibleClips.findIndex((c) => c.id === resolved);
      const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % visibleClips.length;
      // Approaching the end of what's loaded? Kick off a load-more so the
      // rotation has fresh material before we wrap back to clip 0.
      if (nextIndex >= visibleClips.length - 2 && !endOfFeed && !loadingMore && cursor) {
        void loadMore();
      }
      return visibleClips[nextIndex].id;
    });
  }, [visibleClips, endOfFeed, loadingMore, cursor, loadMore]);

  const myUid = profile.uid;

  // Reorder so the rotating clip is always rendered at index 0 (and thus
  // gets the autoplay TopClipVideo branch below). The rest of the feed
  // keeps its reverse-chronological order behind it.
  const orderedClips = useMemo(() => {
    if (visibleClips.length === 0) return visibleClips;
    const idx = effectiveTopClipId ? visibleClips.findIndex((c) => c.id === effectiveTopClipId) : -1;
    if (idx <= 0) return visibleClips;
    return [visibleClips[idx], ...visibleClips.filter((_, i) => i !== idx)];
  }, [visibleClips, effectiveTopClipId]);

  return (
    <section className="mb-6" aria-label="Community feed">
      {/* Section header — matches Lobby's other section headings (SKATERS, ACTIVE, COMPLETED) */}
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">FEED</h3>
        {visibleClips.length > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
            {visibleClips.length}
          </span>
        )}
      </div>

      {/* Error */}
      {error && !loading && (
        <div className="glass-card rounded-2xl p-5 mb-3 border border-brand-red/30">
          <p className="font-body text-sm text-white/80 mb-3">{error}</p>
          {/* Surface the Firestore error code in dev so "Couldn't load" is
              actually diagnosable from a dev-tools screenshot. Hidden in
              prod to keep the user-facing copy clean. */}
          {errorCode && import.meta.env.DEV && (
            <p className="font-body text-[10px] text-faint mb-3">code: {errorCode}</p>
          )}
          <Btn onClick={loadFirstPage} variant="secondary">
            Try again
          </Btn>
        </div>
      )}

      {/* Loading (first page) */}
      {loading && (
        <div className="flex flex-col items-center py-10" role="status" aria-label="Loading clips">
          <div className="relative w-10 h-10 mb-3">
            <div className="absolute inset-0 rounded-full border-2 border-border" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-brand-orange animate-spin" />
          </div>
          <p className="font-body text-xs text-faint">Loading feed…</p>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && visibleClips.length === 0 && (
        <div className="flex flex-col items-center py-10 border border-dashed border-white/[0.06] rounded-2xl bg-surface/30">
          <FilmIcon size={24} className="mb-3 opacity-40 text-subtle" />
          <p className="font-body text-sm text-dim">No clips yet.</p>
          <p className="font-body text-xs text-faint mt-1">Land a trick to start filling the feed.</p>
        </div>
      )}

      {/* Clips list */}
      {!loading && visibleClips.length > 0 && (
        <ul className="space-y-4" aria-label="Clips feed">
          {orderedClips.map((clip, index) => {
            const isOwnClip = clip.playerUid === myUid;
            const upvote = upvoteState.get(clip.id) ?? { count: 0, alreadyUpvoted: false };
            const isUpvoting = upvotingIds.has(clip.id);
            const upvoteDisabled = isOwnClip || upvote.alreadyUpvoted || isUpvoting;
            return (
              <li key={clip.id} className="glass-card rounded-2xl overflow-hidden">
                {/* Top meta row: player + time + role badge */}
                <div className="flex items-center justify-between px-4 pt-3.5 pb-3">
                  <button
                    type="button"
                    onClick={() => onViewPlayer(clip.playerUid)}
                    className="flex items-center gap-2 touch-target rounded-xl px-1.5 py-1 -ml-1.5 hover:bg-white/[0.03] transition-colors duration-200 group"
                  >
                    <div className="w-7 h-7 rounded-full bg-brand-orange/10 border border-brand-orange/20 flex items-center justify-center shrink-0">
                      <span className="font-display text-[11px] text-brand-orange leading-none">
                        {clip.playerUsername[0]?.toUpperCase() ?? "?"}
                      </span>
                    </div>
                    <ProUsername
                      username={clip.playerUsername}
                      className="font-body text-xs text-white/80 group-hover:text-brand-orange transition-colors duration-200"
                    />
                  </button>
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-display text-[10px] tracking-[0.2em] px-2 py-0.5 rounded-md border ${
                        clip.role === "set"
                          ? "text-brand-orange border-brand-orange/30 bg-brand-orange/5"
                          : "text-brand-green border-brand-green/30 bg-brand-green/5"
                      }`}
                      aria-label={clip.role === "set" ? "Setter's landed trick" : "Matcher's landed response"}
                    >
                      {clip.role === "set" ? "SET" : "MATCH"}
                    </span>
                    <span className="font-body text-[11px] text-faint">{relativeClipTime(clip.createdAt)}</span>
                  </div>
                </div>

                {/* Video — top clip autoplays muted with tap-to-unmute. When
                    the top clip ends it rotates to the next landed-trick
                    clip in the feed, so the lobby always feels alive even
                    before the user scrolls. Subsequent clips stay
                    click-to-play to keep mobile data + battery sane. The
                    key forces a fresh muted state on every rotation tick.
                    When only one clip is visible, there's nothing to
                    rotate to — hand off to the native `loop` attribute
                    so the single clip replays without a stall gap. */}
                <div className="px-4">
                  {index === 0 ? (
                    <TopClipVideo
                      key={clip.id}
                      src={clip.videoUrl}
                      loop={visibleClips.length <= 1}
                      onEnded={visibleClips.length > 1 ? advanceTopClip : undefined}
                    />
                  ) : (
                    <video
                      src={clip.videoUrl}
                      controls
                      playsInline
                      preload="metadata"
                      className="w-full aspect-[9/16] max-h-[560px] rounded-xl bg-black object-cover border border-border"
                    />
                  )}
                </div>

                {/* Trick name */}
                <div className="px-4 pt-3">
                  <h2 className="font-display text-xl text-white tracking-wide leading-tight">{clip.trickName}</h2>
                </div>

                {/* Actions */}
                <div className="px-4 pt-3 pb-4 flex items-center gap-2">
                  {!isOwnClip && (
                    <button
                      type="button"
                      onClick={() => handleUpvote(clip)}
                      disabled={upvoteDisabled}
                      aria-pressed={upvote.alreadyUpvoted}
                      aria-label={
                        upvote.alreadyUpvoted
                          ? `Upvoted · ${upvote.count}`
                          : `Upvote clip by @${clip.playerUsername} · current count ${upvote.count}`
                      }
                      className={`min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 border transition-all duration-300 ease-smooth focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed active:scale-[0.97] ${
                        upvote.alreadyUpvoted
                          ? "border-brand-orange/40 bg-brand-orange/15 text-brand-orange"
                          : "border-border bg-surface/60 text-white/90 hover:border-brand-orange/30 hover:bg-brand-orange/5"
                      }`}
                    >
                      <FlameIcon
                        size={14}
                        className={upvote.alreadyUpvoted ? "text-brand-orange" : "text-brand-orange/80"}
                      />
                      <span className="font-display text-xs tracking-wider tabular-nums">{upvote.count}</span>
                    </button>
                  )}
                  {!isOwnClip && (
                    <button
                      type="button"
                      onClick={() => onChallengeUser(clip.playerUsername)}
                      aria-label={`Challenge @${clip.playerUsername}`}
                      className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl font-display text-sm tracking-wider bg-gradient-to-r from-brand-orange via-[#FF7A1A] to-[#FF8533] text-white active:scale-[0.97] hover:-translate-y-0.5 transition-all duration-300 shadow-[0_2px_12px_rgba(255,107,0,0.18)] ring-1 ring-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                    >
                      <span>Challenge</span>
                      <ChevronRightIcon size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setReportTarget(clip)}
                    disabled={isOwnClip}
                    aria-label={`Report clip by @${clip.playerUsername}`}
                    className="flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2.5 font-display text-[11px] tracking-[0.15em] text-faint border border-border hover:text-white hover:border-border-hover hover:bg-white/[0.02] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300"
                  >
                    <FlagIcon size={13} />
                    REPORT
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Pagination */}
      {!loading && visibleClips.length > 0 && !endOfFeed && !loadMoreError && (
        <div className="mt-4">
          <Btn onClick={loadMore} variant="secondary" disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Btn>
        </div>
      )}

      {/* Load-more failure — shown in place of the Load more button so the
          already-loaded clips above stay visible and the user sees a real
          affordance to retry (rather than a silently stuck feed). */}
      {!loading && visibleClips.length > 0 && !endOfFeed && loadMoreError && (
        <div className="glass-card rounded-2xl p-5 mt-4 border border-brand-red/30">
          <p className="font-body text-sm text-white/80 mb-3">{loadMoreError}</p>
          {loadMoreErrorCode && import.meta.env.DEV && (
            <p className="font-body text-[10px] text-faint mb-3">code: {loadMoreErrorCode}</p>
          )}
          <Btn onClick={loadMore} variant="secondary" disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Try again"}
          </Btn>
        </div>
      )}

      {!loading && visibleClips.length > 0 && endOfFeed && (
        <p className="font-body text-xs text-faint text-center mt-4">You're all caught up.</p>
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
 * Auto-playing top-of-feed clip with a tap-to-unmute affordance.
 *
 * Autoplay+muted by default; tapping the video toggles audio. Lives inline
 * rather than as a shared component because this surface and
 * `TurnHistoryViewer.ClipVideo` have slightly different chrome — premature
 * abstraction would obscure more than it would save.
 *
 * Pauses when scrolled out of the viewport so the clip isn't silently
 * decoding audio/video frames while the user reads the rest of the feed
 * — a meaningful battery and cellular-data saving on mobile.
 */
function TopClipVideo({ src, loop = false, onEnded }: { src: string; loop?: boolean; onEnded?: () => void }) {
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLButtonElement | null>(null);
  // Tracks whether the video has ever successfully started playing. We use
  // this to gate the IntersectionObserver's pause(): if pause() runs before
  // the first play() resolves, mobile Safari treats the muted-autoplay
  // grant as revoked and silently rejects every subsequent play() — which
  // is exactly the "feed loaded but no clips play" symptom.
  const hasPlayedRef = useRef(false);
  const handlePlay = useCallback(() => {
    // Belt-and-suspenders: if the native `autoPlay` attribute fires
    // before (or instead of) our IO-driven play() call, flip the gate
    // here too so a subsequent out-of-viewport pause() is still allowed.
    hasPlayedRef.current = true;
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      const el = videoRef.current;
      if (el) el.muted = next;
      return next;
    });
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    // IntersectionObserver is unavailable in some older browsers and most
    // jsdom test environments — skip the pause-on-scroll enhancement
    // rather than crash. Autoplay continues in full uninterrupted mode.
    if (!video || !container || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          // play() returns a Promise that rejects on interrupted
          // autoplay (e.g. user tab-switches mid-resume). Swallow —
          // the browser will retry on next intersection tick. We call
          // play() explicitly rather than rely on the `autoPlay`
          // attribute, because autoPlay only fires on element insert
          // and is unreliable when the element mounts off-screen.
          video
            .play()
            .then(() => {
              hasPlayedRef.current = true;
            })
            .catch(() => undefined);
        } else if (hasPlayedRef.current) {
          // Only pause once the video has actually started playing. The
          // mount-time "below the fold" callback would otherwise race
          // the autoplay attempt and revoke the muted-autoplay grant.
          video.pause();
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <button
      ref={containerRef}
      type="button"
      onClick={toggleMute}
      aria-label={muted ? "Unmute clip" : "Mute clip"}
      className="relative block w-full text-left rounded-xl overflow-hidden border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay
        loop={loop}
        muted
        playsInline
        preload="metadata"
        onPlay={handlePlay}
        onEnded={onEnded}
        className="w-full aspect-[9/16] max-h-[560px] bg-black object-cover"
      />
      {muted && (
        <span
          aria-hidden="true"
          className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] font-display tracking-[0.2em] text-white backdrop-blur"
        >
          MUTED · TAP
        </span>
      )}
    </button>
  );
}
