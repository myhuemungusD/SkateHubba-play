import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Spot } from "../../types/spot";
import { getSpotsInBounds } from "../../services/spots";
import { logger } from "../../services/logger";
import { captureMessage } from "../../lib/sentry";
import { MAPBOX_TOKEN, MAP_STYLE, MAP_DEFAULTS } from "../../lib/mapbox";
import { applySpotFilters, DEFAULT_SPOT_FILTERS, type SpotFilters } from "./SpotFilterBar";
import { injectPulseCSS } from "./spotMapStyles";

interface UseSpotMapOptions {
  activeGameSpotId?: string;
  onSpotSelect?: (spot: Spot) => void;
}

interface UseSpotMapResult {
  mapContainer: React.RefObject<HTMLDivElement | null>;
  spots: Spot[];
  visibleSpots: Spot[];
  filters: SpotFilters;
  setFilters: React.Dispatch<React.SetStateAction<SpotFilters>>;
  selectedSpot: Spot | null;
  setSelectedSpot: React.Dispatch<React.SetStateAction<Spot | null>>;
  isAddingSpot: boolean;
  setIsAddingSpot: React.Dispatch<React.SetStateAction<boolean>>;
  userLocation: { lat: number; lng: number } | null;
  isTrackingUser: boolean;
  gpsError: string | null;
  gpsBannerDismissed: boolean;
  setGpsBannerDismissed: React.Dispatch<React.SetStateAction<boolean>>;
  toast: string | null;
  mapLoading: boolean;
  mapLoadTimeout: boolean;
  handleRecenter: () => void;
  handleAddSpotSuccess: (spot: Spot) => void;
}

const DEBOUNCE_MS = 400;
const BOUNDS_DELTA_THRESHOLD = 0.001;

type MarkerEntry = { marker: mapboxgl.Marker; cleanup: () => void };

function getGpsErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case 1:
      return "Location permission denied. Enable in browser settings.";
    case 2:
      return "Location unavailable. Check your location services.";
    case 3:
      return "Location request timed out. Try again.";
    default:
      return "Unable to get location";
  }
}

// Create spot marker element
function createMarkerEl(spot: Spot, isActiveGame: boolean): HTMLDivElement {
  const el = document.createElement("div");
  el.style.width = "20px";
  el.style.height = "20px";
  el.style.borderRadius = "50%";
  el.style.border = "1px solid white";
  el.style.cursor = "pointer";
  el.style.position = "relative";
  el.style.backgroundColor = spot.isVerified ? "#22C55E" : "#F97316";
  // Test hook — anonymous marker divs are otherwise unselectable in e2e
  // without coordinate math.
  el.setAttribute("data-testid", `spot-marker-${spot.id}`);

  if (isActiveGame) {
    const ring = document.createElement("div");
    ring.className = "spot-pulse-ring";
    el.appendChild(ring);
  }

  return el;
}

/**
 * Controller hook for {@link SpotMap}: owns the imperative Mapbox lifecycle,
 * GPS watch, viewport-debounced spot fetch, marker diffing, and all
 * derived state. The view component is a pure projection of this hook's
 * return value.
 */
export function useSpotMap({ activeGameSpotId, onSpotSelect }: UseSpotMapOptions): UseSpotMapResult {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, MarkerEntry>>(new Map());
  const userMarker = useRef<mapboxgl.Marker | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBoundsRef = useRef<{ n: number; s: number; e: number; w: number } | null>(null);
  const hasLockedRef = useRef(false);
  // Keep a ref to latest userLocation so callbacks don't go stale
  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  // Track the previously-rendered active game spot so we can rebuild the
  // affected markers when it changes (the markers diff below otherwise
  // short-circuits on existing spot ids and never updates the pulse ring).
  const prevActiveSpotRef = useRef<string | undefined>(undefined);

  const [spots, setSpots] = useState<Spot[]>([]);
  const [filters, setFilters] = useState<SpotFilters>(DEFAULT_SPOT_FILTERS);
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const [isAddingSpot, setIsAddingSpot] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isTrackingUser, setIsTrackingUser] = useState(true);

  const [gpsError, setGpsError] = useState<string | null>(() =>
    "geolocation" in navigator ? null : "Geolocation not supported by your browser",
  );
  const [gpsBannerDismissed, setGpsBannerDismissed] = useState(false);
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

  // Keep ref in sync
  useEffect(() => {
    userLocationRef.current = userLocation;
  }, [userLocation]);

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

  // Fetch spots inside the current viewport via the Firestore spots service.
  // No AbortController: the Firestore SDK has no native cancellation. Instead
  // each fetch bumps `fetchGenerationRef` so a stale resolver knows to drop
  // its result, which gives us the same "only the latest pan wins" behavior
  // without pretending to cancel in-flight Firestore RPCs.
  const fetchGenerationRef = useRef(0);
  const fetchSpots = useCallback((mapInstance: mapboxgl.Map) => {
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);

    fetchTimerRef.current = setTimeout(() => {
      const bounds = mapInstance.getBounds();
      if (!bounds) return;
      const n = bounds.getNorth();
      const s = bounds.getSouth();
      const e = bounds.getEast();
      const w = bounds.getWest();

      // Skip if bounds delta is too small
      if (lastBoundsRef.current) {
        const prev = lastBoundsRef.current;
        if (
          Math.abs(n - prev.n) < BOUNDS_DELTA_THRESHOLD &&
          Math.abs(s - prev.s) < BOUNDS_DELTA_THRESHOLD &&
          Math.abs(e - prev.e) < BOUNDS_DELTA_THRESHOLD &&
          Math.abs(w - prev.w) < BOUNDS_DELTA_THRESHOLD
        ) {
          return;
        }
      }
      lastBoundsRef.current = { n, s, e, w };

      const generation = ++fetchGenerationRef.current;
      getSpotsInBounds({ north: n, south: s, east: e, west: w })
        .then((spotsList) => {
          // Drop the result if a newer pan has started in the meantime.
          if (generation !== fetchGenerationRef.current) return;
          setSpots(spotsList);
        })
        .catch((err: unknown) => {
          if (generation !== fetchGenerationRef.current) return;
          logger.warn("fetch_spots_failed", {
            error: err instanceof Error ? err.message : "unknown",
          });
        });
    }, DEBOUNCE_MS);
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
  }, [fetchSpots]);

  // GPS tracking
  useEffect(() => {
    if (!("geolocation" in navigator)) return;

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        setGpsError(null);
        setGpsBannerDismissed(false);

        // Fly to user on first GPS lock, then user can pan freely
        if (!hasLockedRef.current && map.current) {
          map.current.flyTo({ center: [loc.lng, loc.lat], zoom: 15 });
          hasLockedRef.current = true;
        }
      },
      (err) => {
        setGpsError(getGpsErrorMessage(err));
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );

    watchIdRef.current = id;

    return () => {
      navigator.geolocation.clearWatch(id);
      watchIdRef.current = null;
    };
  }, []);

  // Update user marker
  useEffect(() => {
    if (!map.current || !userLocation) return;

    if (!userMarker.current) {
      const el = document.createElement("div");
      el.style.position = "relative";
      el.style.width = "12px";
      el.style.height = "12px";

      const accuracy = document.createElement("div");
      accuracy.className = "spot-user-accuracy";
      el.appendChild(accuracy);

      const dot = document.createElement("div");
      dot.className = "spot-user-dot";
      el.appendChild(dot);

      userMarker.current = new mapboxgl.Marker({ element: el })
        .setLngLat([userLocation.lng, userLocation.lat])
        .addTo(map.current);
    } else {
      userMarker.current.setLngLat([userLocation.lng, userLocation.lat]);
    }

    // Follow user if tracking is on
    if (isTrackingUser && map.current) {
      map.current.easeTo({ center: [userLocation.lng, userLocation.lat], duration: 500 });
    }
  }, [userLocation, isTrackingUser]);

  // Update spot markers — track listeners for proper cleanup.
  // Driven off `visibleSpots` so toggling filters immediately removes markers
  // from the map (and restores them on clear) without a new Firestore read.
  useEffect(() => {
    if (!map.current) return;

    const currentIds = new Set(visibleSpots.map((s) => s.id));
    const existingIds = new Set(markersRef.current.keys());

    // If the active game spot changed, evict the previously-active marker
    // and the newly-active marker (if present) so the add-new loop below
    // recreates them with the correct pulse-ring state. Without this,
    // toggling activeGameSpotId while `spots` is unchanged would be a no-op
    // because the loop short-circuits on existing ids.
    const prevActive = prevActiveSpotRef.current;
    if (prevActive !== activeGameSpotId) {
      for (const id of [prevActive, activeGameSpotId]) {
        if (id && markersRef.current.has(id)) {
          const entry = markersRef.current.get(id)!;
          entry.cleanup();
          entry.marker.remove();
          markersRef.current.delete(id);
        }
      }
      prevActiveSpotRef.current = activeGameSpotId;
    }

    // Remove markers no longer in view
    for (const id of existingIds) {
      if (!currentIds.has(id)) {
        const entry = markersRef.current.get(id);
        if (entry) {
          entry.cleanup();
          entry.marker.remove();
        }
        markersRef.current.delete(id);
      }
    }

    // Add new markers (including any we just evicted above)
    for (const spot of visibleSpots) {
      if (markersRef.current.has(spot.id)) continue;

      const isActiveGame = spot.id === activeGameSpotId;
      const el = createMarkerEl(spot, isActiveGame);

      const listener = (e: MouseEvent) => {
        e.stopPropagation();
        setSelectedSpot(spot);
        onSpotSelect?.(spot);
      };
      el.addEventListener("click", listener);

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([spot.longitude, spot.latitude])
        .addTo(map.current!);

      markersRef.current.set(spot.id, {
        marker,
        cleanup: () => el.removeEventListener("click", listener),
      });
    }
  }, [visibleSpots, activeGameSpotId, onSpotSelect]);

  // Cleanup all timers and markers on unmount. The stale-fetch guard is
  // handled via fetchGenerationRef above, not via AbortController.
  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      for (const entry of markers.values()) {
        entry.cleanup();
        entry.marker.remove();
      }
      markers.clear();
    };
  }, []);

  const handleRecenter = useCallback(() => {
    const loc = userLocationRef.current;
    if (!loc) {
      showToast("Waiting for location…");
      return;
    }
    if (!map.current) return;
    setIsTrackingUser(true);
    map.current.flyTo({ center: [loc.lng, loc.lat], zoom: 15 });
  }, [showToast]);

  const handleAddSpotSuccess = useCallback((spot: Spot) => {
    setIsAddingSpot(false);
    setSelectedSpot(spot);
    if (map.current) {
      map.current.flyTo({ center: [spot.longitude, spot.latitude], zoom: 16 });
    }
    setSpots((prev) => [...prev, spot]);
  }, []);

  return {
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
  };
}
