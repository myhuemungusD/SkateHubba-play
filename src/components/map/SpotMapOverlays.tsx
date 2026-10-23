import { Crosshair, MapPinOff, X } from "lucide-react";

interface SpotMapUnavailableProps {
  onRetry?: () => void;
  /** Offer the no-map list of nearby spots (design audit #31). */
  onUseList?: () => void;
}

/** Secondary action under Retry: browse nearby spots without the map. */
function UseListButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-auto mt-2 block min-h-11 px-6 py-2.5 rounded-xl font-semibold text-sm text-white hover:bg-white/10 transition-colors"
    >
      Use list view
    </button>
  );
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
export function SpotMapUnavailable({ onRetry, onUseList }: SpotMapUnavailableProps) {
  return (
    <div role="alert" aria-live="polite" className="w-full h-dvh flex items-center justify-center bg-background">
      <div className="text-center px-6 max-w-xs flex flex-col items-center">
        <div
          className="w-14 h-14 rounded-full bg-surface-alt border border-line-strong flex items-center justify-center mb-4"
          aria-hidden="true"
        >
          <MapPinOff size={24} className="text-brand-orange" />
        </div>
        <p className="text-soft text-sm mb-1">Map is temporarily unavailable.</p>
        <p className="text-dim text-xs mb-5">Check back in a few minutes.</p>
        <button
          type="button"
          onClick={() => (onRetry ? onRetry() : window.location.reload())}
          className="min-h-11 px-6 py-2.5 bg-brand-orange text-black rounded-xl font-semibold text-sm
                     hover:bg-brand-orange-hover transition-colors"
        >
          Retry
        </button>
        {onUseList && <UseListButton onClick={onUseList} />}
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
          <div className="absolute inset-0 rounded-full border-2 border-line" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-brand-orange animate-spin" />
        </div>
        <div className="text-muted text-sm">Loading map…</div>
      </div>
    </div>
  );
}

export function MapLoadTimeoutOverlay({ onRetry, onUseList }: SpotMapUnavailableProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="absolute inset-0 z-40 bg-background flex items-center justify-center"
    >
      <div className="text-center px-6 max-w-xs">
        <p className="text-soft text-sm mb-1">The map is taking too long to load.</p>
        <p className="text-dim text-xs mb-5">Check your connection and try again.</p>
        <button
          type="button"
          onClick={() => (onRetry ? onRetry() : window.location.reload())}
          className="min-h-11 px-6 py-2.5 bg-brand-orange text-black rounded-xl font-semibold text-sm
                     hover:bg-brand-orange-hover transition-colors"
        >
          Retry
        </button>
        {onUseList && <UseListButton onClick={onUseList} />}
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
      className="absolute top-16 left-3 right-3 z-30 bg-surface-alt border border-line-strong rounded-xl px-4 py-3
                 text-sm text-soft flex items-start gap-2"
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
      className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-surface-alt/95 backdrop-blur border border-line-strong
                 rounded-xl px-4 py-3 text-sm text-soft flex flex-col items-center gap-2 max-w-[86%]"
    >
      <span>No spots in view yet.</span>
      <button type="button" onClick={onAddSpot} className="text-xs font-semibold text-brand-orange hover:underline">
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
      className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-surface-alt/95 backdrop-blur border border-line-strong
                 rounded-xl px-4 py-2 text-sm text-soft"
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
      className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-surface-alt border border-line-strong rounded-xl px-4 py-2 text-sm text-white"
    >
      {message}
    </div>
  );
}

/**
 * Recenter button: 44×44pt (HIG minimum, matches the zoom buttons in
 * spotMap.css). The border / fill change when tracking is active so users
 * can tell at a glance whether the map will follow them.
 */
export function RecenterButton({ tracking, onClick }: { tracking: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={tracking ? "Following your location" : "Recenter to my location"}
      aria-pressed={tracking}
      className={`absolute bottom-36 right-2.5 z-20 w-11 h-11 rounded-lg flex items-center justify-center transition-colors ${
        tracking
          ? "bg-brand-orange border border-brand-orange text-black"
          : "bg-surface-alt border border-line-strong text-white hover:bg-line-strong"
      }`}
    >
      <Crosshair size={18} aria-hidden="true" />
    </button>
  );
}
