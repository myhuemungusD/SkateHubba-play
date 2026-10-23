import { useLayoutEffect, useRef, useState } from "react";
import { VideoOff } from "lucide-react";

/** The feed page after this one, if the clip sits in the vertical feed. */
function nextSlide(from: HTMLElement | null): HTMLElement | null {
  const next = from?.closest("[data-feed-slide]")?.nextElementSibling;
  return next instanceof HTMLElement && next.hasAttribute("data-feed-slide") ? next : null;
}

const BTN =
  "inline-flex min-h-11 items-center justify-center rounded-xl px-5 font-body text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";

/**
 * Overlay for a clip that failed to load (audit #25): an icon, a plain
 * sentence, Retry, and "Skip to next" when there is a next page in the feed,
 * so a dead clip never strands the viewer on a black screen.
 */
export function ClipPlaybackError({ onRetry }: { onRetry: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasNext, setHasNext] = useState(false);
  useLayoutEffect(() => setHasNext(nextSlide(ref.current) !== null), []);

  return (
    <div
      ref={ref}
      role="alert"
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/70 p-6 text-center backdrop-blur-sm"
    >
      <VideoOff size={28} aria-hidden="true" className="text-subtle" />
      <p className="font-body text-base font-semibold text-white">Couldn&apos;t play this clip</p>
      <p className="font-body text-sm text-muted">Check your connection, or move on to the next one.</p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={onRetry} aria-label="Retry clip" className={`${BTN} btn-secondary`}>
          Retry
        </button>
        {hasNext && (
          <button
            type="button"
            onClick={() => nextSlide(ref.current)?.scrollIntoView?.({ block: "start", behavior: "smooth" })}
            className={`${BTN} btn-primary-fill`}
          >
            Skip to next
          </button>
        )}
      </div>
    </div>
  );
}
