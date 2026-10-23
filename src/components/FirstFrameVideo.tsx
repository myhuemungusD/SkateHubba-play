import { useState, type Ref, type SyntheticEvent, type VideoHTMLAttributes } from "react";
import { captureException } from "../lib/sentry";
import { CLIP_PLACEHOLDER, FIRST_FRAME_SECONDS, withFirstFrame } from "../lib/clipPoster";

/** Shown in place of a clip that failed to load or decode. */
export const CLIP_UNPLAYABLE_MESSAGE = "This clip can't be played right now.";

type FirstFrameVideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, "src" | "poster" | "preload"> & {
  /** The clip's own URL. The first-frame fragment is added here. */
  src: string;
  ref?: Ref<HTMLVideoElement>;
  /** Sentry context for a playback failure. */
  errorContext?: string;
};

/**
 * A clip player whose still is the clip's own first frame (see clipPoster).
 *
 * Two device gaps are covered:
 * - Older iOS (below 17.4) can't decode WebM at all, and a fetch can fail.
 *   Without a fallback that's a permanent black box with native controls, so
 *   a failed clip swaps to the neutral placeholder and a short, neutral note.
 *   The note blames nothing: WebKit reports the same "not supported" code
 *   (4) for an expired token or a deleted clip (403/404) as for a codec it
 *   can't decode. It offers no retry, because reloading the same URL fails
 *   the same way; the Sentry event keeps the real code for triage.
 * - iOS 15 to 17.3 doesn't always honour the `#t=` fragment on blob: URLs
 *   (local previews). When metadata loads and the player is still parked at
 *   0, it seeks to the same first-frame time by hand so a frame is painted.
 *
 * No `poster`: WebM plus a poster fails to play in iOS WKWebView (videojs
 * #8895), and preload is always "metadata" so the frame can be drawn.
 */
export function FirstFrameVideo({
  src,
  ref,
  className,
  errorContext = "FirstFrameVideo",
  onError,
  onLoadedMetadata,
  ...rest
}: FirstFrameVideoProps) {
  // Keyed on src, so a new clip (GameReplay's next clip) gets a fresh try.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const label = rest["aria-label"];

  if (failedSrc === src) {
    return (
      <div
        role="img"
        aria-label={label ? `${label} (can't play)` : "Clip can't play"}
        className={`relative overflow-hidden ${className ?? ""}`}
      >
        <img src={CLIP_PLACEHOLDER} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />
        <p className="absolute inset-x-3 bottom-3 rounded-lg bg-black/70 px-3 py-2 text-center font-body text-xs text-white">
          {CLIP_UNPLAYABLE_MESSAGE}
        </p>
      </div>
    );
  }

  const handleError = (e: SyntheticEvent<HTMLVideoElement>) => {
    const mediaError = e.currentTarget.error;
    setFailedSrc(src);
    captureException(new Error("Video playback failed"), {
      extra: { context: errorContext, url: src, label, mediaError: mediaError?.message, code: mediaError?.code },
    });
    onError?.(e);
  };

  const handleLoadedMetadata = (e: SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (v.paused && v.currentTime === 0) v.currentTime = FIRST_FRAME_SECONDS;
    onLoadedMetadata?.(e);
  };

  return (
    <video
      ref={ref}
      {...rest}
      src={withFirstFrame(src)}
      preload="metadata"
      className={className}
      onError={handleError}
      onLoadedMetadata={handleLoadedMetadata}
    />
  );
}
