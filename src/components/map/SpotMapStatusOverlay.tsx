import { MapPinOff } from "lucide-react";

interface RetryButtonProps {
  onRetry?: () => void;
}

function handleRetryClick(onRetry?: () => void): void {
  if (onRetry) {
    onRetry();
    return;
  }
  window.location.reload();
}

/**
 * Polished fallback shown when the build is missing the Mapbox token.
 * Visually matched to the load-timeout state (icon + copy + Retry) so the
 * screen reads as an intentional empty state rather than a broken app.
 * `onRetry` is still offered: in the rare case the token was missing due
 * to a transient bundling issue, a remount can recover without a full
 * page reload that would throw away session state.
 */
export function SpotMapUnavailable({ onRetry }: RetryButtonProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="w-full flex items-center justify-center bg-background"
      style={{ height: "100dvh" }}
    >
      <div className="text-center px-6 max-w-xs flex flex-col items-center">
        <div
          className="w-14 h-14 rounded-full bg-surface-alt border border-[#333] flex items-center justify-center mb-4"
          aria-hidden="true"
        >
          <MapPinOff size={24} className="text-[#F97316]" />
        </div>
        <p className="text-[#CCC] text-sm mb-1">Map is temporarily unavailable.</p>
        <p className="text-dim text-xs mb-5">Check back in a few minutes.</p>
        <button
          type="button"
          onClick={() => handleRetryClick(onRetry)}
          className="px-6 py-2.5 bg-[#F97316] text-white rounded-xl font-semibold text-sm
                     hover:bg-[#EA580C] transition-colors"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

/** Spinner overlay shown while Mapbox is initializing. */
export function SpotMapLoadingOverlay() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading map"
      className="absolute inset-0 z-40 bg-background flex items-center justify-center"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="relative w-10 h-10" aria-hidden="true">
          <div className="absolute inset-0 rounded-full border-2 border-[#222]" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#F97316] animate-spin" />
        </div>
        <div className="text-muted text-sm">Loading map…</div>
      </div>
    </div>
  );
}

/**
 * Friendly retry state shown when Mapbox never fires its `load` event within
 * 15s — preferable to a perpetually spinning overlay.
 */
export function SpotMapLoadTimeoutOverlay({ onRetry }: RetryButtonProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="absolute inset-0 z-40 bg-background flex items-center justify-center"
    >
      <div className="text-center px-6 max-w-xs">
        <p className="text-[#CCC] text-sm mb-1">The map is taking too long to load.</p>
        <p className="text-dim text-xs mb-5">Check your connection and try again.</p>
        <button
          type="button"
          onClick={() => handleRetryClick(onRetry)}
          className="px-6 py-2.5 bg-[#F97316] text-white rounded-xl font-semibold text-sm
                     hover:bg-[#EA580C] transition-colors"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
