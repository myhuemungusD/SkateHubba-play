import { Component, useCallback, useEffect, useState, type ReactNode } from "react";
import { SpotMap } from "../components/map/SpotMap";
import { useGameContext } from "../context/GameContext";
import { analytics } from "../services/analytics";

interface ErrorBoundaryState {
  hasError: boolean;
}

/** Error boundary specific to the map page — prevents a Mapbox crash from blanking the app.
 *  Recovery order: in-app reset (clears boundary + remounts SpotMap via the `onReset` callback)
 *  first; full-page reload only as the fallback when the in-app path keeps tripping. */
class MapErrorBoundary extends Component<{ children: ReactNode; onReset?: () => void }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    console.warn("MapErrorBoundary caught:", error.message);
  }

  handleReset = (): void => {
    this.props.onReset?.();
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="w-full flex items-center justify-center bg-background"
          style={{ height: "100dvh" }}
        >
          <div className="text-center px-6 max-w-xs">
            <p className="text-[#CCC] text-sm mb-1">Something went wrong loading the map.</p>
            <p className="text-faint text-xs mb-5">Try again — this usually fixes it.</p>
            <div className="flex flex-col items-stretch gap-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="min-h-[44px] px-6 bg-[#F97316] text-white rounded-xl font-semibold text-sm
                           hover:bg-[#EA580C] transition-colors"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="min-h-[44px] px-6 text-muted hover:text-white text-xs transition-colors"
              >
                Reload page
              </button>
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
