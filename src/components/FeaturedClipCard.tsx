/**
 * Lobby's featured-clip card. Fetches one random landed-trick clip on mount
 * and offers two actions: upvote (single-tap, no undo — spec) and Challenge
 * (routes through the Lobby's existing `onChallengeUser` handler which sets
 * `challengeTarget` in App.tsx and navigates to `/challenge`).
 *
 * Per CLAUDE.md guardrails this is plain React + local state only — no
 * external state library. The session-scoped "already-seen" set lives at
 * module scope so the exclude list survives Lobby re-mounts (e.g. after
 * navigating into a game and back) while still resetting on full reload.
 *
 * Error / empty / no-auth-ready states all hide the card silently: the
 * active-games list is the lobby's primary content and a broken featured
 * card must never push it below the fold with an error banner.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlreadyUpvotedError, fetchFeaturedClip, upvoteClip, type FeaturedClip } from "../services/clips";
import { logger } from "../services/logger";
import { parseFirebaseError } from "../utils/helpers";
import { ProUsername } from "./ProUsername";
import { FlameIcon, MapPinIcon, ChevronRightIcon } from "./icons";

/** Session-scoped set of shown clip ids. Module-local so Lobby re-mounts
 *  don't re-surface the same clip; cleared on full page reload per spec. */
const seenClipIds = new Set<string>();

type Status = "loading" | "ready" | "hidden";

export interface FeaturedClipCardProps {
  myUid: string;
  onChallengeUser: (username: string) => void;
  onViewPlayer: (uid: string) => void;
  /** Disables Challenge when the caller can't start games yet
   *  (e.g. email unverified). Matches the Lobby's existing gate. */
  canChallenge: boolean;
}

export function FeaturedClipCard({ myUid, onChallengeUser, onViewPlayer, canChallenge }: FeaturedClipCardProps) {
  const [status, setStatus] = useState<Status>("loading");
  const [clip, setClip] = useState<FeaturedClip | null>(null);
  const [muted, setMuted] = useState(true);
  const [upvoting, setUpvoting] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const exclude = Array.from(seenClipIds);
    setStatus("loading");

    fetchFeaturedClip(myUid, exclude)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result) {
          setStatus("hidden");
          return;
        }
        seenClipIds.add(result.id);
        setClip(result);
        setStatus("ready");
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        logger.warn("featured_clip_load_failed", { error: parseFirebaseError(err) });
        setStatus("hidden");
      });

    return () => controller.abort();
  }, [myUid]);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      const el = videoRef.current;
      if (el) el.muted = next;
      return next;
    });
  }, []);

  const handleUpvote = useCallback(async () => {
    if (!clip || upvoting || clip.alreadyUpvoted) return;
    setUpvoting(true);
    // Optimistic: flip to upvoted immediately so tapping feels instant. Any
    // failure short of AlreadyUpvotedError rolls back so the user can retry.
    setClip((prev) => (prev ? { ...prev, alreadyUpvoted: true, upvoteCount: prev.upvoteCount + 1 } : prev));
    try {
      const nextCount = await upvoteClip(myUid, clip.id);
      setClip((prev) => (prev ? { ...prev, upvoteCount: nextCount, alreadyUpvoted: true } : prev));
    } catch (err) {
      if (err instanceof AlreadyUpvotedError) {
        // Server thinks we already upvoted (e.g. a second device). Keep the
        // optimistic filled state — it matches ground truth.
        return;
      }
      logger.warn("featured_clip_upvote_failed", { clipId: clip.id, error: parseFirebaseError(err) });
      setClip((prev) =>
        prev ? { ...prev, alreadyUpvoted: false, upvoteCount: Math.max(0, prev.upvoteCount - 1) } : prev,
      );
    } finally {
      setUpvoting(false);
    }
  }, [clip, upvoting, myUid]);

  const handleChallenge = useCallback(() => {
    if (!clip) return;
    onChallengeUser(clip.playerUsername);
  }, [clip, onChallengeUser]);

  if (status === "loading") return <FeaturedClipSkeleton />;
  if (status === "hidden" || !clip) return null;

  const isOwnClip = clip.playerUid === myUid;
  const upvoteDisabled = clip.alreadyUpvoted || upvoting;

  return (
    <section className="mb-6 glass-card rounded-2xl overflow-hidden" aria-label="Featured clip">
      {/* Video — tap anywhere to toggle mute (mobile-first idiom) */}
      <div className="relative">
        <button
          type="button"
          onClick={handleToggleMute}
          aria-label={muted ? "Unmute clip" : "Mute clip"}
          className="block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          <video
            ref={videoRef}
            src={clip.videoUrl}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
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
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-4 pt-10 pb-4">
            <h2 className="font-display text-xl leading-tight text-white tracking-wide">{clip.trickName}</h2>
            {clip.spotName && (
              <p className="mt-1 flex items-center gap-1 font-body text-xs text-white/80">
                <MapPinIcon size={11} className="shrink-0" />
                <span className="truncate">{clip.spotName}</span>
              </p>
            )}
          </div>
        </button>
      </div>

      {/* Player row */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-3">
        <button
          type="button"
          onClick={() => onViewPlayer(clip.playerUid)}
          className="flex items-center gap-2 rounded-xl px-1.5 py-1 -ml-1.5 min-h-[44px] hover:bg-white/[0.03] transition-colors duration-200 group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          aria-label={`View @${clip.playerUsername}'s profile`}
        >
          <div className="w-8 h-8 rounded-full bg-brand-orange/10 border border-brand-orange/20 flex items-center justify-center shrink-0">
            <span className="font-display text-xs text-brand-orange leading-none">
              {clip.playerUsername[0]?.toUpperCase() ?? "?"}
            </span>
          </div>
          <ProUsername
            username={clip.playerUsername}
            className="font-body text-sm text-white/90 group-hover:text-brand-orange transition-colors duration-200"
          />
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-stretch gap-2 px-4 pb-4">
        <button
          type="button"
          onClick={handleUpvote}
          disabled={upvoteDisabled}
          aria-pressed={clip.alreadyUpvoted}
          aria-label={
            clip.alreadyUpvoted ? `Upvoted · ${clip.upvoteCount}` : `Upvote clip · current count ${clip.upvoteCount}`
          }
          className={`flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border transition-all duration-300 ease-smooth focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed active:scale-[0.97] ${
            clip.alreadyUpvoted
              ? "border-brand-orange/40 bg-brand-orange/15 text-brand-orange"
              : "border-border bg-surface/60 text-white/90 hover:border-brand-orange/30 hover:bg-brand-orange/5"
          }`}
        >
          <FlameIcon size={16} className={clip.alreadyUpvoted ? "text-brand-orange" : "text-brand-orange/80"} />
          <span className="font-display text-sm tracking-wider tabular-nums">{clip.upvoteCount}</span>
        </button>

        <button
          type="button"
          onClick={handleChallenge}
          disabled={!canChallenge || isOwnClip}
          aria-label={
            isOwnClip
              ? "You can't challenge yourself"
              : canChallenge
                ? `Challenge @${clip.playerUsername}`
                : "Verify your email to challenge"
          }
          className={`flex-[1.4] min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl font-display text-sm tracking-wider transition-all duration-300 ease-smooth focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange active:scale-[0.97] ${
            canChallenge && !isOwnClip
              ? "bg-gradient-to-r from-brand-orange via-[#FF7A1A] to-[#FF8533] text-white hover:-translate-y-0.5 shadow-[0_2px_12px_rgba(255,107,0,0.2)] ring-1 ring-white/[0.08]"
              : "bg-brand-orange/15 text-white/50 border border-brand-orange/15 cursor-not-allowed"
          }`}
        >
          <span>Challenge</span>
          <ChevronRightIcon size={14} />
        </button>
      </div>
    </section>
  );
}

function FeaturedClipSkeleton() {
  return (
    <section aria-hidden="true" className="mb-6 glass-card rounded-2xl overflow-hidden border border-white/[0.04]">
      <div className="w-full aspect-[9/16] max-h-[420px] bg-white/[0.03] animate-pulse" />
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <div className="w-8 h-8 rounded-full bg-white/[0.04] animate-pulse" />
        <div className="h-3 w-24 rounded bg-white/[0.04] animate-pulse" />
      </div>
      <div className="flex gap-2 px-4 pb-4">
        <div className="h-11 flex-1 rounded-xl bg-white/[0.03] animate-pulse" />
        <div className="h-11 flex-[1.4] rounded-xl bg-white/[0.04] animate-pulse" />
      </div>
    </section>
  );
}
