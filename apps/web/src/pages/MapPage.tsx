import { Component, useEffect, type ReactNode } from "react";
import { SpotMap } from "../components/map/SpotMap";

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

interface MapPageProps {
  /**
   * If set, the spot with this id is rendered with a pulsing ring indicating
   * the active S.K.A.T.E. game's location. Threaded from GameContext via
   * the top-level `<Route path="/map">` in `src/App.tsx` rather than
   * imported directly here, to keep `apps/web` self-contained and avoid
   * crossing the `rootDir: ./src` boundary.
   */
  activeGameSpotId?: string;
  /**
   * Fired once per MapPage mount — top of the map funnel.
   * Threaded from the analytics module at the src/App.tsx level; the
   * `apps/web` subtree deliberately stays analytics-agnostic.
   */
  onMapViewed?: () => void;
  /**
   * Fired when the user opens a spot preview card from the map.
   */
  onSpotPreviewed?: (spotId: string) => void;
}

export function MapPage({ activeGameSpotId, onMapViewed, onSpotPreviewed }: MapPageProps = {}) {
  useEffect(() => {
    onMapViewed?.();
    // Only fire once per mount — downstream listeners treat this as a page-view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <MapErrorBoundary>
      <SpotMap
        activeGameSpotId={activeGameSpotId}
        // Adapt: SpotMap gives us the full Spot, analytics only needs the id.
        onSpotSelect={onSpotPreviewed ? (spot) => onSpotPreviewed(spot.id) : undefined}
      />
    </MapErrorBoundary>
  );
}
