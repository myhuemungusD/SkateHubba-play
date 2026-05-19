import { memo, useEffect, useRef } from "react";

interface ConnectionLike {
  saveData?: boolean;
  effectiveType?: string;
}

interface NavigatorWithConnection extends Navigator {
  connection?: ConnectionLike;
}

/**
 * True when the viewer signalled they don't want optional bandwidth burned
 * — Data Saver on, or a 2g/slow-2g effective connection. We respect both
 * because the prefetch is a UX nicety, not a correctness requirement.
 */
function shouldPrefetch(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as NavigatorWithConnection).connection;
  if (!conn) return true;
  if (conn.saveData) return false;
  if (conn.effectiveType === "2g" || conn.effectiveType === "slow-2g") return false;
  return true;
}

/**
 * Off-screen `<video preload="auto">` that warms the browser cache for the
 * NEXT clip while the current clip is still playing. When the viewer taps
 * NEXT TRICK, the spotlight `<video>` either renders the first frame
 * immediately from cache or — at minimum — has the moov atom + first chunk
 * already in flight, collapsing the "tap → first frame" gap from a full
 * cold-load round-trip (300–900ms on mobile) to decode-only latency.
 *
 * Combined with the immutable Cache-Control header we set on upload, the
 * prefetched bytes also stick around for cross-session views of the same
 * clip without re-fetching.
 *
 * Returns null on unsupported / Data-Saver / 2g connections so we never
 * burn bytes the viewer didn't ask for.
 */
export const NextClipPrefetcher = memo(function NextClipPrefetcher({ src }: { src: string | null }) {
  // Anchor the hidden video off the document body via a ref so React doesn't
  // try to reconcile its playback state on every parent render.
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!src || !shouldPrefetch()) return;
    const el = ref.current;
    if (!el) return;
    // Trigger a metadata + first-chunk fetch even on browsers that ignore
    // the preload attribute on hidden elements. load() is a no-op when the
    // src hasn't changed, so this is cheap on re-render.
    el.src = src;
    el.load();
  }, [src]);

  if (!src) return null;
  return (
    <video
      ref={ref}
      muted
      playsInline
      preload="auto"
      // aria-hidden + the inert + zero-size styles keep the prefetcher off
      // the accessibility tree and render tree without using `display:none`,
      // which some browsers honour by aborting the network fetch.
      aria-hidden="true"
      tabIndex={-1}
      style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
    />
  );
});
