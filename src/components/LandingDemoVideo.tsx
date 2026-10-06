import { useEffect, useRef } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion";

/**
 * Landing-page gameplay demo loop.
 *
 * Perf contract (mobile landing budget):
 *   - `preload="none"` + `poster`: zero video bytes are fetched until the
 *     clip actually needs to play. The poster (~25 KB WebP) fills the box.
 *   - Playback is driven by an IntersectionObserver instead of `autoPlay`:
 *     the clip starts when it scrolls into view and pauses when it leaves,
 *     so a visitor who never scrolls past the hero never downloads it.
 *   - prefers-reduced-motion: no observer, no playback — poster only.
 *
 * The asset is a 640×360 / 24 fps H.264 encode with no audio track (it was
 * always muted) and `+faststart`, so the first frame paints off the first
 * range request.
 */
export const LANDING_VIDEO_SRC = "/sh-video-edit.mp4";
export const LANDING_VIDEO_POSTER = "/sh-video-poster.webp";

export function LandingDemoVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const video = videoRef.current;
    if (!video || reducedMotion) return;
    // React sets `muted` as a property only; set it explicitly (and the
    // default) so iOS Safari treats play() as a muted, gesture-free autoplay.
    video.muted = true;
    video.defaultMuted = true;

    const play = () => {
      // play() rejects when autoplay is blocked (e.g. Low Power Mode). The
      // poster stays up in that case — nothing else to do.
      video.play()?.catch(() => undefined);
    };

    if (typeof IntersectionObserver === "undefined") {
      play();
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) play();
        else if (!video.paused) video.pause();
      },
      { threshold: 0.25 },
    );
    observer.observe(video);
    return () => {
      observer.disconnect();
      video.pause();
    };
  }, [reducedMotion]);

  return (
    <video
      ref={videoRef}
      loop
      muted
      playsInline
      preload="none"
      poster={LANDING_VIDEO_POSTER}
      width={640}
      height={360}
      disablePictureInPicture
      controlsList="nodownload noplaybackrate"
      className="w-full h-auto aspect-video object-cover bg-surface"
      aria-label="SkateHubba gameplay demo"
      data-testid="landing-demo-video"
    >
      <source src={LANDING_VIDEO_SRC} type="video/mp4" />
    </video>
  );
}
