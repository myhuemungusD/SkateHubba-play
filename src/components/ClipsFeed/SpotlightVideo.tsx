import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRightIcon } from "../icons";

/**
 * Single-clip video with tap-to-unmute and a Replay / Next Trick overlay on end.
 *
 * Autoplays muted once (no loop, no auto-advance). Pauses when scrolled out of
 * the viewport — but only AFTER the first play() has resolved, because mobile
 * Safari revokes the muted-autoplay grant if pause() runs too early, which
 * surfaces as "feed loaded but clip won't play".
 */
export function SpotlightVideo({ src, onNext }: { src: string; onNext: () => void }) {
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
