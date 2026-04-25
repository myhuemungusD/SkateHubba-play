import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Crosshair, Plus } from "lucide-react";
import type { Spot } from "../../types/spot";
import { logger } from "../../services/logger";
import { captureMessage } from "../../lib/sentry";
import { MAPBOX_TOKEN, MAP_STYLE, MAP_DEFAULTS } from "../../lib/mapbox";
import { SpotPreviewCard } from "./SpotPreviewCard";
import { AddSpotSheet } from "./AddSpotSheet";
import { SpotFilterBar, applySpotFilters, DEFAULT_SPOT_FILTERS, type SpotFilters } from "./SpotFilterBar";
import { injectPulseCSS } from "./spotMapStyles";
import { useSpotsInBounds } from "./useSpotsInBounds";
import { useUserGeolocation } from "./useUserGeolocation";
import { useSpotMarkers } from "./useSpotMarkers";
import {
  SpotMapUnavailable,
  MapLoadingOverlay,
  MapLoadTimeoutOverlay,
  GpsErrorBanner,
  EmptyViewportPrompt,
  NoFilterMatchesNotice,
  MapToast,
} from "./SpotMapOverlays";

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
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { spots, setSpots, fetchSpots } = useSpotsInBounds();
  const [filters, setFilters] = useState<SpotFilters>(DEFAULT_SPOT_FILTERS);
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const [isAddingSpot, setIsAddingSpot] = useState(false);

  const {
    userLocation,
    isTrackingUser,
    setIsTrackingUser,
    gpsError,
    gpsBannerDismissed,
    setGpsBannerDismissed,
    handleRecenter: recenterToUser,
  } = useUserGeolocation({ map });

  const [toast, setToast] = useState<string | null>(null);
  const [mapLoading, setMapLoading] = useState(true);
  // Surface a friendly error when Mapbox never fires `load` (blocked network,
  // invalid token, tile host unreachable) — otherwise the overlay would spin
  // forever, which is the loudest "broken app" complaint on competitor apps.
  const [mapLoadTimeout, setMapLoadTimeout] = useState(false);

  // Spots to actually render on the map after applying client-side filters.
  // Kept as a memoized derivation so marker diffing below doesn't re-run when
  // the filter object is referentially stable.
  const visibleSpots = useMemo(() => applySpotFilters(spots, filters), [spots, filters]);

  // Surface the missing-token condition to telemetry so ops notice the
  // outage without waiting on a user screenshot. `MAPBOX_TOKEN` is a module
  // constant, so this effect fires at most once per mount.
  //
  // Two channels on purpose:
  //   - logger.warn → structured console + Sentry breadcrumb (context for
  //     any subsequent errors in this session).
  //   - captureMessage → a real Sentry event so alert rules can fire; a
  //     breadcrumb alone never creates an issue.
  useEffect(() => {
    if (!MAPBOX_TOKEN) {
      logger.warn("map_token_missing", {});
      captureMessage("map_token_missing", "warning");
    }
  }, []);

  // Show toast briefly with proper cleanup
  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3000);
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    // Guard: without a token Mapbox silently fails network requests and the
    // load event never fires, leaving the overlay stuck forever. The JSX
    // below renders a dedicated unavailable-state instead.
    if (!MAPBOX_TOKEN) return;

    injectPulseCSS();
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAP_STYLE,
      zoom: MAP_DEFAULTS.zoom,
      minZoom: MAP_DEFAULTS.minZoom,
      maxZoom: MAP_DEFAULTS.maxZoom,
      center: [-118.2437, 34.0522], // Assumption: default to Los Angeles
    });

    // Add zoom controls
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

    // Disable tracking when user manually pans
    m.on("dragstart", () => {
      setIsTrackingUser(false);
    });

    // Fetch spots on moveend
    m.on("moveend", () => {
      fetchSpots(m);
    });

    // Initial fetch after load. The info-level log closes the observability
    // loop — paired with `map_token_missing` / `map_load_timeout` it lets us
    // compute a real load-success rate in Sentry instead of guessing.
    m.on("load", () => {
      setMapLoading(false);
      logger.info("map_loaded", {});
      fetchSpots(m);
    });

    // Safety net: if the load event doesn't fire within 15s (e.g. offline,
    // blocked CSP, tile server 5xx), show the friendly error state instead
    // of a perpetually spinning overlay.
    const loadTimeout = setTimeout(() => {
      setMapLoadTimeout((v) => {
        if (!v) {
          logger.warn("map_load_timeout", {});
        }
        return true;
      });
    }, 15_000);

    map.current = m;

    return () => {
      clearTimeout(loadTimeout);
      m.remove();
      map.current = null;
    };
  }, [fetchSpots, setIsTrackingUser]);

  const handleSpotClick = useCallback(
    (spot: Spot) => {
      setSelectedSpot(spot);
      onSpotSelect?.(spot);
    },
    [onSpotSelect],
  );

  useSpotMarkers({ map, visibleSpots, activeGameSpotId, onSpotClick: handleSpotClick });

  // Cleanup the toast timer on unmount. Marker / fetch-timer cleanup lives
  // in the dedicated hooks; the stale-fetch guard is generation-based.
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const handleRecenter = useCallback(() => {
    recenterToUser(() => showToast("Waiting for location…"));
  }, [recenterToUser, showToast]);

  const handleAddSpotSuccess = useCallback(
    (spot: Spot) => {
      setIsAddingSpot(false);
      setSelectedSpot(spot);
      if (map.current) {
        map.current.flyTo({ center: [spot.longitude, spot.latitude], zoom: 16 });
      }
      setSpots((prev) => [...prev, spot]);
    },
    [setIsAddingSpot, setSelectedSpot, setSpots],
  );

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
      {mapLoading && !mapLoadTimeout && <MapLoadingOverlay />}

      {mapLoading && mapLoadTimeout && <MapLoadTimeoutOverlay onRetry={onRetry} />}

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

      {/* GPS error banner — dismissible so it doesn't permanently squat on
          the top of the viewport for users who intentionally declined
          location permission. */}
      {gpsError && !gpsBannerDismissed && (
        <GpsErrorBanner message={gpsError} onDismiss={() => setGpsBannerDismissed(true)} />
      )}

      {/* Empty state — two distinct messages: (1) nothing in the viewport at
          all → invite the user to add one; (2) spots exist but filters are
          hiding them → hint to loosen filters. */}
      {!mapLoading && spots.length === 0 && <EmptyViewportPrompt onAddSpot={() => setIsAddingSpot(true)} />}

      {!mapLoading && spots.length > 0 && visibleSpots.length === 0 && <NoFilterMatchesNotice />}

      {/* Toast */}
      {toast && <MapToast message={toast} />}

      {/* Recenter button — bumped from 32px to 40px to hit WCAG 2.5.5 min
          target size, and the border / fill change when tracking is active
          so users can tell at a glance whether the map will follow them. */}
      <button
        type="button"
        onClick={handleRecenter}
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

      {/* Add spot FAB */}
      <button
        type="button"
        onClick={() => setIsAddingSpot(true)}
        className="absolute bottom-24 right-2.5 z-20 w-12 h-12 bg-[#F97316] rounded-full
                   flex items-center justify-center text-white shadow-lg
                   hover:bg-[#EA580C] transition-colors"
        aria-label="Add a spot"
      >
        <Plus size={24} />
      </button>

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
