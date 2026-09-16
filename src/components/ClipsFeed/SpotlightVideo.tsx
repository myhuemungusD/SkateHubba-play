import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ChevronRightIcon } from "../icons";
import { useReducedMotion } from "../../hooks/useReducedMotion";

/**
 * Single-clip video with tap-to-unmute and a Replay / Next Trick overlay on end.
 *
 * Autoplays muted once (no loop, no auto-advance). Pauses when scrolled out of
 * the viewport — but only AFTER the first play() has resolved, because mobile
 * Safari revokes the muted-autoplay grant if pause() runs too early, which
 * surfaces as "feed loaded but clip won't play".
 *
 * memo: this is the most expensive child in the spotlight subtree (video
 * element + IntersectionObserver). The parent SpotlightCard is also memoised
 * — between them every unrelated lobby state mutation skips the video JS.
 */
const NEXT_BTN =
  "min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl px-5 font-display text-sm tracking-wider bg-gradient-to-r from-brand-orange via-[#FF7A1A] to-[#FF8533] text-white active:scale-[0.97] hover:-translate-y-0.5 transition-all shadow-[0_2px_12px_rgba(255,107,0,0.18)] ring-1 ring-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0";

const SECONDARY_BTN =
  "min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl px-5 border border-border bg-surface/80 text-white/90 font-display text-sm tracking-wider hover:bg-white/[0.04] active:scale-[0.97] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";

/** Shared NEXT TRICK control for the ended and failed overlays. */
function NextTrickButton({ onNext, advancing }: { onNext: () => void; advancing: boolean }) {
  return (
    <button type="button" onClick={onNext} disabled={advancing} aria-label="Next trick" className={NEXT_BTN}>
      {advancing ? "LOADING…" : "NEXT TRICK"}
      {!advancing && <ChevronRightIcon size={14} />}
    </button>
  );
}

interface SpotlightVideoProps {
  src: string;
  onNext: () => void;
  /** True while the feed is fetching the next page — NEXT TRICK shows a pending state. */
  advancing?: boolean;
}

function SpotlightVideoImpl({ src, onNext, advancing = false }: SpotlightVideoProps) {
  const [muted, setMuted] = useState(true);
  const [ended, setEnded] = useState(false);
  // The media element raised `error` — a deleted or expired file, an
  // unsupported codec, a dead network. Without an escape hatch here the
  // viewer is stuck: the only NEXT TRICK control lives on the ended overlay,
  // and a clip that never loads never ends.
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasPlayedRef = useRef(false);
  // When the user prefers reduced motion we never auto-start the clip — the
  // tap-to-unmute overlay doubles as an explicit play affordance instead.
  const reducedMotion = useReducedMotion();

  const handlePlay = useCallback(() => {
    hasPlayedRef.current = true;
    setEnded(false);
  }, []);

  const handleEnded = useCallback(() => {
    setEnded(true);
  }, []);

  const handleError = useCallback(() => {
    setFailed(true);
  }, []);

  const handleRetry = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    setFailed(false);
    // load() re-issues the fetch for the same src; a transient network drop
    // recovers here without remounting the element.
    el.load();
    el.play().catch(() => undefined);
  }, []);

  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    // Reduced-motion clips never autoplay, so the first overlay tap is the
    // explicit play affordance instead of a mute toggle. Once it has started
    // (hasPlayedRef), and in all non-reduced-motion cases, the tap toggles
    // mute exactly as before — non-reduced-motion behavior is unchanged.
    if (reducedMotion && !hasPlayedRef.current && el) {
      el.play().catch(() => undefined);
      return;
    }
    setMuted((prev) => {
      const next = !prev;
      if (el) el.muted = next;
      return next;
    });
  }, [reducedMotion]);

  const handleReplay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = 0;
    setEnded(false);
    el.play().catch(() => undefined);
  }, []);

  // Reset the autoplay-grant gate when the clip changes. Without this, the
  // ref stays `true` from the previous src and a brief out-of-viewport blip
  // mid-load can pause the new clip before its muted-autoplay grant has
  // resolved — exactly the failure mode the gate was designed to prevent.
  // `ended` is cleared by handlePlay() when the new clip starts, so we
  // only need to reset the ref here.
  useEffect(() => {
    hasPlayedRef.current = false;
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container || typeof IntersectionObserver === "undefined") return;
    // Honour prefers-reduced-motion: skip the auto-play-on-scroll entirely so
    // the clip stays paused until the user explicitly taps the overlay.
    if (reducedMotion) return;

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
  }, [reducedMotion]);

  return (
    <div ref={containerRef} className="relative rounded-xl overflow-hidden border border-border">
      <video
        ref={videoRef}
        src={src}
        autoPlay={!reducedMotion}
        muted
        playsInline
        // preload="auto" — this video IS the LCP element; we always intend
        // to play it immediately. "metadata" stalls between the moov-atom
        // fetch and the first media chunk, costing a round-trip that
        // becomes wasted latency before first frame. The bytes are
        // immutable (storage upload sets `cacheControl: max-age=1y,
        // immutable`) so an aggressive preload also primes browser cache
        // for the inevitable REPLAY.
        preload="auto"
        onPlay={handlePlay}
        onEnded={handleEnded}
        onError={handleError}
        className="w-full aspect-[9/16] max-h-[560px] bg-black object-cover"
      />

      {/* Tap-to-unmute overlay. Hidden once the clip ends (or fails) so the
          overlay below can receive taps. */}
      {!ended && !failed && (
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

      {/* Playback failure: RETRY or NEXT TRICK. Takes precedence over the
          ended overlay — a clip that errored mid-play is still unplayable. */}
      {failed && (
        <div
          role="alert"
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm p-4"
        >
          <p className="font-display text-[11px] tracking-[0.2em] text-white/70">Couldn&apos;t play this clip</p>
          <div className="flex items-center gap-3">
            <button type="button" onClick={handleRetry} aria-label="Retry clip" className={SECONDARY_BTN}>
              RETRY
            </button>
            <NextTrickButton onNext={onNext} advancing={advancing} />
          </div>
        </div>
      )}

      {/* End-of-clip prompt: REPLAY or NEXT TRICK. */}
      {ended && !failed && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm p-4">
          <p className="font-display text-[11px] tracking-[0.2em] text-white/70">Clip ended</p>
          <div className="flex items-center gap-3">
            <button type="button" onClick={handleReplay} aria-label="Replay clip" className={SECONDARY_BTN}>
              REPLAY
            </button>
            <NextTrickButton onNext={onNext} advancing={advancing} />
          </div>
        </div>
      )}
    </div>
  );
}

export const SpotlightVideo = memo(SpotlightVideoImpl);
