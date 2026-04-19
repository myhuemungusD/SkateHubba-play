import type { PullToRefreshState } from "../hooks/usePullToRefresh";

/**
 * Visual indicator for the pull-to-refresh gesture. Renders above the scroll
 * container and is driven entirely by the hook's exposed state — no gesture
 * logic lives here.
 *
 * Positioned `absolute` inside a `relative` wrapper so it floats over the
 * first page of content and fades out as the gesture snaps back.
 */
export function PullToRefreshIndicator({
  offset,
  state,
  triggerReached,
}: {
  offset: number;
  state: PullToRefreshState;
  triggerReached: boolean;
}) {
  const visible = state !== "idle" || offset > 0;
  if (!visible) return null;

  const label = state === "refreshing" ? "Refreshing…" : triggerReached ? "Release to refresh" : "Pull to refresh";

  // Rotate the arrow based on drag progress so the user watches it commit.
  // 0 at rest, 180° once past the trigger threshold, interpolated between.
  const rotation = state === "refreshing" ? 0 : Math.min(180, (offset / 72) * 180);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute left-0 right-0 top-0 flex flex-col items-center justify-end"
      style={{ height: `${offset}px`, opacity: Math.min(1, offset / 48) }}
    >
      <div className="mb-2 flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1.5 backdrop-blur-sm shadow-[0_4px_16px_rgba(0,0,0,0.25)]">
        {state === "refreshing" ? (
          <span
            className="w-3.5 h-3.5 rounded-full border-[1.5px] border-transparent border-t-brand-orange animate-spin"
            aria-hidden="true"
          />
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`text-brand-orange transition-transform duration-200 ${triggerReached ? "text-brand-green" : ""}`}
            style={{ transform: `rotate(${rotation}deg)` }}
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="19 12 12 19 5 12" />
          </svg>
        )}
        <span
          className={`font-display text-[11px] tracking-wider leading-none ${
            state === "refreshing" ? "text-brand-orange" : triggerReached ? "text-brand-green" : "text-muted"
          }`}
        >
          {label}
        </span>
      </div>
    </div>
  );
}
