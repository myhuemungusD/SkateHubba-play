import { MapPinOff, X } from "lucide-react";

interface SpotMapUnavailableProps {
  onRetry?: () => void;
}

/**
 * Dedicated unavailable state shown when `MAPBOX_TOKEN` is missing.
 *
 * Visually matched to the load-timeout state (icon + copy + Retry) so the
 * screen reads as an intentional empty state rather than a broken app.
 * `onRetry` is still offered: in the rare case the token was missing due
 * to a transient bundling issue, a remount can recover without a full
 * page reload that would throw away session state.
 */
export function SpotMapUnavailable({ onRetry }: SpotMapUnavailableProps) {
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
          onClick={() => (onRetry ? onRetry() : window.location.reload())}
          className="px-6 py-2.5 bg-[#F97316] text-white rounded-xl font-semibold text-sm
                     hover:bg-[#EA580C] transition-colors"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

export function MapLoadingOverlay() {
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

interface MapLoadTimeoutOverlayProps {
  onRetry?: () => void;
}

export function MapLoadTimeoutOverlay({ onRetry }: MapLoadTimeoutOverlayProps) {
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
          onClick={() => (onRetry ? onRetry() : window.location.reload())}
          className="px-6 py-2.5 bg-[#F97316] text-white rounded-xl font-semibold text-sm
                     hover:bg-[#EA580C] transition-colors"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

interface GpsErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export function GpsErrorBanner({ message, onDismiss }: GpsErrorBannerProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="absolute top-16 left-3 right-3 z-30 bg-surface-alt border border-[#333] rounded-xl px-4 py-3
                 text-sm text-[#CCC] flex items-start gap-2"
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss location notice"
        className="text-muted hover:text-white flex-shrink-0 -mr-1 -mt-0.5"
      >
        <X size={16} />
      </button>
    </div>
  );
}

interface EmptyViewportPromptProps {
  onAddSpot: () => void;
}

export function EmptyViewportPrompt({ onAddSpot }: EmptyViewportPromptProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-surface-alt/95 backdrop-blur border border-[#333]
                 rounded-xl px-4 py-3 text-sm text-[#CCC] flex flex-col items-center gap-2 max-w-[86%]"
    >
      <span>No spots in view yet.</span>
      <button type="button" onClick={onAddSpot} className="text-xs font-semibold text-[#F97316] hover:underline">
        Add the first spot here
      </button>
    </div>
  );
}

export function NoFilterMatchesNotice() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-surface-alt/95 backdrop-blur border border-[#333]
                 rounded-xl px-4 py-2 text-sm text-[#CCC]"
    >
      No spots match your filters.
    </div>
  );
}

interface MapToastProps {
  message: string;
}

export function MapToast({ message }: MapToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-surface-alt border border-[#333] rounded-xl px-4 py-2 text-sm text-white"
    >
      {message}
    </div>
  );
}
