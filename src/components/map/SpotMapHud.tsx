import { Crosshair, Plus, X } from "lucide-react";

interface GpsErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

/**
 * GPS error banner — dismissible so it doesn't permanently squat on the top
 * of the viewport for users who intentionally declined location permission.
 */
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

interface NoSpotsEmptyStateProps {
  onAddSpot: () => void;
}

/** Shown when the viewport has no spots at all — invites the user to add one. */
export function NoSpotsEmptyState({ onAddSpot }: NoSpotsEmptyStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-surface-alt/95 backdrop-blur border border-[#333]
                 rounded-xl px-4 py-3 text-sm text-[#CCC] flex flex-col items-center gap-2 max-w-[86%]"
    >
      <span>No spots in view yet.</span>
      <button
        type="button"
        onClick={onAddSpot}
        className="text-xs font-semibold text-[#F97316] hover:underline"
      >
        Add the first spot here
      </button>
    </div>
  );
}

/** Shown when spots exist in the viewport but filters hide them all. */
export function NoFilterMatchesState() {
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

interface RecenterButtonProps {
  isTrackingUser: boolean;
  onRecenter: () => void;
}

/**
 * Recenter button — bumped from 32px to 40px to hit WCAG 2.5.5 min target
 * size. Border / fill change when tracking is active so users can tell at a
 * glance whether the map will follow them.
 */
export function RecenterButton({ isTrackingUser, onRecenter }: RecenterButtonProps) {
  return (
    <button
      type="button"
      onClick={onRecenter}
      aria-label={isTrackingUser ? "Following your location" : "Recenter to my location"}
      aria-pressed={isTrackingUser}
      className={`absolute bottom-36 right-2.5 z-20 w-10 h-10 rounded-lg
                  flex items-center justify-center transition-colors ${
                    isTrackingUser
                      ? "bg-[#F97316] border border-[#F97316] text-white"
                      : "bg-surface-alt border border-[#333] text-white hover:bg-[#333]"
                  }`}
    >
      <Crosshair size={18} aria-hidden="true" />
    </button>
  );
}

interface AddSpotFabProps {
  onClick: () => void;
}

export function AddSpotFab({ onClick }: AddSpotFabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-24 right-2.5 z-20 w-12 h-12 bg-[#F97316] rounded-full
                 flex items-center justify-center text-white shadow-lg
                 hover:bg-[#EA580C] transition-colors"
      aria-label="Add a spot"
    >
      <Plus size={24} />
    </button>
  );
}
