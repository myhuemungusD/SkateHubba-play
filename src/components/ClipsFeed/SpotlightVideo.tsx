import { memo, useCallback, useEffect, useRef, useState } from "react";
import { PlayIcon } from "../icons";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { BELOW_HEADER, RAIL_BTN } from "./feedLayout";

/**
 * Full-bleed clip player for one snapped page.
 *
 * The active clip autoplays muted and loops until the viewer swipes away.
 * IntersectionObserver pauses it once it has actually started — an early
 * pause() revokes the muted-autoplay grant on mobile Safari. Reduced motion
 * never autoplays; the center control is an explicit play button.
 *
 * Far slides unmount this entirely (see `isNearSlide`). The next slide stays
 * mounted so its bytes are in flight, but `active` is false so it stays paused.
 */

export interface SpotlightVideoProps {
  src: string;
  /** False when another slide is the one on screen. */
  active?: boolean;
  /** Accessible name for the media element (disputes name the attempt). */
  mediaLabel?: string;
  /** Shared across slides so unmuting sticks as you swipe. */
  muted?: boolean;
  onToggleMute?: () => void;
}

function MuteGlyph({ muted }: { muted: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H3v6h3l5 4V5z" strokeLinejoin="round" />
      {muted ? (
        <path d="m22 9-6 6m0-6 6 6" strokeLinecap="round" />
      ) : (
        <path d="M16 9a5 5 0 0 1 0 6M19 7a8 8 0 0 1 0 10" strokeLinecap="round" />
      )}
    </svg>
  );
}

function SpotlightVideoImpl({ src, active = true, mediaLabel, muted: mutedProp, onToggleMute }: SpotlightVideoProps) {
  const [localMuted, setLocalMuted] = useState(true);
  const muted = mutedProp ?? localMuted;
  const reducedMotion = useReducedMotion();
  const [paused, setPaused] = useState(true);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasPlayedRef = useRef(false);
  const userPausedRef = useRef(false);
  // True on the first commit when this slide mounts already active, so the
  // effect below leaves the autoplay attribute + IntersectionObserver in
  // charge. A slide that mounts paused (the prefetched next one) flips this
  // and plays only when it becomes the snapped page.
  const wasActiveRef = useRef(active);

  const handlePlay = useCallback(() => {
    hasPlayedRef.current = true;
    setPaused(false);
  }, []);

  const handlePause = useCallback(() => {
    setPaused(true);
  }, []);

  const handleError = useCallback(() => {
    setFailedSrc(src);
  }, [src]);

  const handleRetry = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    setFailedSrc(null);
    el.load();
    if (active && !reducedMotion) el.play().catch(() => undefined);
  }, [active, reducedMotion]);

  const toggleMute = useCallback(() => {
    if (onToggleMute) {
      onToggleMute();
      return;
    }
    setLocalMuted((prev) => {
      const next = !prev;
      const el = videoRef.current;
      if (el) el.muted = next;
      return next;
    });
  }, [onToggleMute]);

  const togglePlayback = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      userPausedRef.current = false;
      el.play().catch(() => undefined);
      return;
    }
    userPausedRef.current = true;
    el.pause();
  }, []);

  useEffect(() => {
    hasPlayedRef.current = false;
    userPausedRef.current = false;
  }, [src]);

  useEffect(() => {
    const el = videoRef.current;
    if (el) el.muted = muted;
  }, [muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!active) {
      userPausedRef.current = false;
      if (hasPlayedRef.current) video.pause();
      wasActiveRef.current = false;
      return;
    }
    const becameActive = !wasActiveRef.current;
    wasActiveRef.current = true;
    if (!becameActive || reducedMotion || userPausedRef.current) return;
    video
      .play()
      .then(() => {
        hasPlayedRef.current = true;
      })
      .catch(() => undefined);
  }, [active, reducedMotion]);

  useEffect(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container || !active || reducedMotion) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          if (userPausedRef.current) return;
          video
            .play()
            .then(() => {
              hasPlayedRef.current = true;
            })
            .catch(() => undefined);
        } else if (hasPlayedRef.current) {
          video.pause();
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [active, reducedMotion]);

  const showPlay = paused;

  return (
    <div ref={containerRef} className="absolute inset-0 bg-black">
      <video
        ref={videoRef}
        src={src}
        aria-label={mediaLabel}
        autoPlay={active && !reducedMotion}
        muted={muted}
        loop
        playsInline
        preload="auto"
        onPlay={handlePlay}
        onPause={handlePause}
        onError={handleError}
        className="h-full w-full object-cover"
      />

      {active && !failed && (
        <button
          type="button"
          onClick={togglePlayback}
          aria-label={paused ? "Play clip" : "Pause clip"}
          className="absolute inset-0 z-10 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          {showPlay && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 flex min-h-[44px] min-w-[44px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white"
            >
              <PlayIcon size={22} />
            </span>
          )}
        </button>
      )}

      {active && (
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute clip" : "Mute clip"}
          className={`absolute z-20 right-3 ${BELOW_HEADER} ${RAIL_BTN}`}
        >
          <MuteGlyph muted={muted} />
        </button>
      )}

      {failed && (
        <div
          role="alert"
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/70 p-4 backdrop-blur-sm"
        >
          <p className="font-display text-[11px] tracking-[0.2em] text-white/70">Couldn&apos;t play this clip</p>
          <button
            type="button"
            onClick={handleRetry}
            aria-label="Retry clip"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-border bg-surface/80 px-5 font-display text-sm tracking-wider text-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            RETRY
          </button>
        </div>
      )}
    </div>
  );
}

export const SpotlightVideo = memo(SpotlightVideoImpl);
