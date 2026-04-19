import { Component, useCallback, useEffect, useState, type ReactNode } from "react";
import { SpotMap } from "../components/map/SpotMap";
import { useGameContext } from "../context/GameContext";
import { analytics } from "../services/analytics";

interface ErrorBoundaryState {
  hasError: boolean;
  retryAttempted: boolean;
}

/** Error boundary specific to the map page — prevents a Mapbox crash from blanking the app.
 *  Recovery order: in-app reset (clears boundary + remounts SpotMap via the `onReset` callback)
 *  is always the primary action. The full-page reload option only surfaces after an in-app
 *  retry has already been attempted and the boundary has tripped again — at that point the
 *  hard reload is a genuine last resort, not the terminal CTA on first failure. */
class MapErrorBoundary extends Component<{ children: ReactNode; onReset?: () => void }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, retryAttempted: false };

  static getDerivedStateFromError(): Pick<ErrorBoundaryState, "hasError"> {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    console.warn("MapErrorBoundary caught:", error.message);
  }

  handleReset = (): void => {
    this.props.onReset?.();
    this.setState({ hasError: false, retryAttempted: true });
  };

  render() {
    if (this.state.hasError) {
      const showReload = this.state.retryAttempted;
      return (
        <div
          role="alert"
          className="w-full flex items-center justify-center bg-background"
          style={{ height: "100dvh" }}
        >
          <div className="text-center px-6 max-w-xs">
            <p className="text-[#CCC] text-sm mb-1">
              {showReload ? "The map still isn't loading." : "Something went wrong loading the map."}
            </p>
            <p className="text-dim text-xs mb-5">
              {showReload
                ? "Reloading the page may help if this keeps happening."
                : "Try again — this usually fixes it."}
            </p>
            <div className="flex flex-col items-stretch gap-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="min-h-[44px] px-6 bg-[#F97316] text-white rounded-xl font-semibold text-sm
                           hover:bg-[#EA580C] transition-colors"
              >
                Try again
              </button>
              {showReload && (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="min-h-[44px] px-6 text-dim hover:text-white text-xs transition-colors"
                >
                  Reload page
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function MapPage() {
  const { activeGame } = useGameContext();
  // Bumping this key remounts SpotMap cleanly — used by both SpotMap's
  // load-timeout Retry and the boundary's in-app reset. Preserves auth
  // session, GameContext, and analytics session through the retry.
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    // Top of the map funnel — fires once per mount, including direct URL
    // visits. Downstream funnel events (spot_previewed, challenge_from_spot)
    // are fired by their respective components.
    analytics.mapViewed();
  }, []);

  const handleRetry = useCallback(() => {
    setRetryKey((n) => n + 1);
  }, []);

  return (
    <MapErrorBoundary onReset={handleRetry}>
      <SpotMap
        key={retryKey}
        activeGameSpotId={activeGame?.spotId ?? undefined}
        onSpotSelect={(spot) => analytics.spotPreviewed(spot.id)}
        onRetry={handleRetry}
      />
    </MapErrorBoundary>
  );
}
