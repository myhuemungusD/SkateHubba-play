import "mapbox-gl/dist/mapbox-gl.css";
import type { Spot } from "../../types/spot";
import { MAPBOX_TOKEN } from "../../lib/mapbox";
import { SpotPreviewCard } from "./SpotPreviewCard";
import { AddSpotSheet } from "./AddSpotSheet";
import { SpotFilterBar } from "./SpotFilterBar";
import { useSpotMap } from "./useSpotMap";
import {
  SpotMapUnavailable,
  SpotMapLoadingOverlay,
  SpotMapLoadTimeoutOverlay,
} from "./SpotMapStatusOverlay";
import {
  GpsErrorBanner,
  NoSpotsEmptyState,
  NoFilterMatchesState,
  MapToast,
  RecenterButton,
  AddSpotFab,
} from "./SpotMapHud";

interface SpotMapProps {
  activeGameSpotId?: string;
  onSpotSelect?: (spot: Spot) => void;
  /**
   * Called when the user clicks "Retry" on the load-timeout error state.
   * The parent is expected to remount this component (e.g. by bumping a
   * `key` prop) so Mapbox re-initializes with fresh state — preferred over
   * a full `window.location.reload()` which throws away unrelated app state
   * (auth session, GameContext, analytics session).
   */
  onRetry?: () => void;
}

export function SpotMap({ activeGameSpotId, onSpotSelect, onRetry }: SpotMapProps) {
  const {
    mapContainer,
    spots,
    visibleSpots,
    filters,
    setFilters,
    selectedSpot,
    setSelectedSpot,
    isAddingSpot,
    setIsAddingSpot,
    userLocation,
    isTrackingUser,
    gpsError,
    gpsBannerDismissed,
    setGpsBannerDismissed,
    toast,
    mapLoading,
    mapLoadTimeout,
    handleRecenter,
    handleAddSpotSuccess,
  } = useSpotMap({ activeGameSpotId, onSpotSelect });

  // If the build is missing the Mapbox token, render a dedicated unavailable
  // state instead of a perpetual "Loading map…" overlay. This path is hit in
  // previews/forks that don't have VITE_MAPBOX_TOKEN wired up.
  if (!MAPBOX_TOKEN) {
    return <SpotMapUnavailable onRetry={onRetry} />;
  }

  return (
    <div className="relative w-full" style={{ height: "100dvh" }}>
      <div ref={mapContainer} className="w-full h-full" />

      {/* Map loading overlay. If the load event doesn't fire within 15s we
          swap to a recoverable error instead of an endless spinner. */}
      {mapLoading && !mapLoadTimeout && <SpotMapLoadingOverlay />}

      {mapLoading && mapLoadTimeout && <SpotMapLoadTimeoutOverlay onRetry={onRetry} />}

      {/* Filter + search bar — hidden until the map is ready so it never
          obscures the loading state. */}
      {!mapLoading && (
        <SpotFilterBar
          filters={filters}
          onChange={setFilters}
          totalCount={spots.length}
          matchCount={visibleSpots.length}
        />
      )}

      {gpsError && !gpsBannerDismissed && (
        <GpsErrorBanner message={gpsError} onDismiss={() => setGpsBannerDismissed(true)} />
      )}

      {/* Empty state — two distinct messages: (1) nothing in the viewport at
          all → invite the user to add one; (2) spots exist but filters are
          hiding them → hint to loosen filters. */}
      {!mapLoading && spots.length === 0 && (
        <NoSpotsEmptyState onAddSpot={() => setIsAddingSpot(true)} />
      )}

      {!mapLoading && spots.length > 0 && visibleSpots.length === 0 && <NoFilterMatchesState />}

      {toast && <MapToast message={toast} />}

      <RecenterButton isTrackingUser={isTrackingUser} onRecenter={handleRecenter} />

      <AddSpotFab onClick={() => setIsAddingSpot(true)} />

      {/* Spot preview card */}
      {selectedSpot && (
        <SpotPreviewCard
          spot={selectedSpot}
          onClose={() => setSelectedSpot(null)}
          activeGameSpotId={activeGameSpotId}
        />
      )}

      {/* Add spot sheet */}
      {isAddingSpot && (
        <AddSpotSheet
          userLocation={userLocation}
          onClose={() => setIsAddingSpot(false)}
          onSuccess={handleAddSpotSuccess}
        />
      )}
    </div>
  );
}
