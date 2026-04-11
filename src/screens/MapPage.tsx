import { Component, useEffect, type ReactNode } from "react";
import { SpotMap } from "../components/map/SpotMap";
import { useGameContext } from "../context/GameContext";
import { analytics } from "../services/analytics";

interface ErrorBoundaryState {
  hasError: boolean;
}

/** Error boundary specific to the map page — prevents a Mapbox crash from blanking the app */
class MapErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    console.warn("MapErrorBoundary caught:", error.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full flex items-center justify-center bg-[#0A0A0A]" style={{ height: "100dvh" }}>
          <div className="text-center px-6">
            <p className="text-[#888] text-sm mb-4">Map failed to load. Please refresh the page.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 bg-[#F97316] text-white rounded-xl font-semibold text-sm
                         hover:bg-[#EA580C] transition-colors"
            >
              Reload Map
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function MapPage() {
  const { activeGame } = useGameContext();

  useEffect(() => {
    // Top of the map funnel — fires once per mount, including direct URL
    // visits. Downstream funnel events (spot_previewed, challenge_from_spot)
    // are fired by their respective components.
    analytics.mapViewed();
  }, []);

  return (
    <MapErrorBoundary>
      <SpotMap
        activeGameSpotId={activeGame?.spotId ?? undefined}
        onSpotSelect={(spot) => analytics.spotPreviewed(spot.id)}
      />
    </MapErrorBoundary>
  );
}
