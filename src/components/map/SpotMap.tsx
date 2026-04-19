import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Crosshair, MapPinOff, Plus, X } from "lucide-react";
import type { Spot } from "../../types/spot";
import { getSpotsInBounds } from "../../services/spots";
import { logger } from "../../services/logger";
import { captureMessage } from "../../lib/sentry";
import { MAPBOX_TOKEN, MAP_STYLE, MAP_DEFAULTS } from "../../lib/mapbox";
import { SpotPreviewCard } from "./SpotPreviewCard";
import { AddSpotSheet } from "./AddSpotSheet";
import { SpotFilterBar, applySpotFilters, DEFAULT_SPOT_FILTERS, type SpotFilters } from "./SpotFilterBar";

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

// Inject pulsing marker CSS once. Respects prefers-reduced-motion: users who
// opt out of motion (vestibular, accessibility) get a static ring instead of
// the infinite pulse — per WCAG 2.3.3.
const PULSE_CSS_ID = "spot-pulse-css";
function injectPulseCSS(): void {
  if (document.getElementById(PULSE_CSS_ID)) return;
  const style = document.createElement("style");
  style.id = PULSE_CSS_ID;
  style.textContent = `
    @keyframes spot-pulse {
      0%   { transform: scale(1);   opacity: 1; }
      70%  { transform: scale(2.2); opacity: 0; }
      100% { transform: scale(1);   opacity: 0; }
    }
    .spot-pulse-ring {
      position: absolute;
      inset: -6px;
      border-radius: 50%;
      border: 2px solid #F97316;
      animation: spot-pulse 1.8s ease-out infinite;
      pointer-events: none;
    }
    @media (prefers-reduced-motion: reduce) {
      .spot-pulse-ring {
        animation: none;
        opacity: 0.7;
      }
    }
    .spot-user-dot {
      width: 12px;
      height: 12px;
      background: #F97316;
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 0 6px rgba(249,115,22,0.5);
    }
    .spot-user-accuracy {
      position: absolute;
      width: 60px;
      height: 60px;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      background: rgba(249,115,22,0.15);
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
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

export function SpotMap({ activeGameSpotId, onSpotSelect, onRetry }: SpotMapProps) {
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
  const fetchSpots = useCallback(
    (mapInstance: mapboxgl.Map) => {
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
    },
    [setSpots],
  );

  // Create spot marker element
  const createMarkerEl = useCallback((spot: Spot, isActiveGame: boolean): HTMLDivElement => {
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
  }, [setUserLocation]);

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
  }, [visibleSpots, activeGameSpotId, createMarkerEl, setSelectedSpot, onSpotSelect]);

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
      showToast("Waiting for location\u2026");
      return;
    }
    if (!map.current) return;
    setIsTrackingUser(true);
    map.current.flyTo({ center: [loc.lng, loc.lat], zoom: 15 });
  }, [setIsTrackingUser, showToast]);

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
  //
  // Visually matched to the load-timeout state (icon + copy + Retry) so the
  // screen reads as an intentional empty state rather than a broken app.
  // `onRetry` is still offered: in the rare case the token was missing due
  // to a transient bundling issue, a remount can recover without a full
  // page reload that would throw away session state.
  if (!MAPBOX_TOKEN) {
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

  return (
    <div className="relative w-full" style={{ height: "100dvh" }}>
      <div ref={mapContainer} className="w-full h-full" />

      {/* Map loading overlay. If the load event doesn't fire within 15s we
          swap to a recoverable error instead of an endless spinner. */}
      {mapLoading && !mapLoadTimeout && (
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
      )}

      {mapLoading && mapLoadTimeout && (
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
      )}

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
        <div
          role="alert"
          aria-live="polite"
          className="absolute top-16 left-3 right-3 z-30 bg-surface-alt border border-[#333] rounded-xl px-4 py-3
                     text-sm text-[#CCC] flex items-start gap-2"
        >
          <span className="flex-1">{gpsError}</span>
          <button
            type="button"
            onClick={() => setGpsBannerDismissed(true)}
            aria-label="Dismiss location notice"
            className="text-muted hover:text-white flex-shrink-0 -mr-1 -mt-0.5"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Empty state — two distinct messages: (1) nothing in the viewport at
          all → invite the user to add one; (2) spots exist but filters are
          hiding them → hint to loosen filters. */}
      {!mapLoading && spots.length === 0 && (
        <div
          role="status"
          aria-live="polite"
          className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-surface-alt/95 backdrop-blur border border-[#333]
                     rounded-xl px-4 py-3 text-sm text-[#CCC] flex flex-col items-center gap-2 max-w-[86%]"
        >
          <span>No spots in view yet.</span>
          <button
            type="button"
            onClick={() => setIsAddingSpot(true)}
            className="text-xs font-semibold text-[#F97316] hover:underline"
          >
            Add the first spot here
          </button>
        </div>
      )}

      {!mapLoading && spots.length > 0 && visibleSpots.length === 0 && (
        <div
          role="status"
          aria-live="polite"
          className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-surface-alt/95 backdrop-blur border border-[#333]
                     rounded-xl px-4 py-2 text-sm text-[#CCC]"
        >
          No spots match your filters.
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-surface-alt border border-[#333] rounded-xl px-4 py-2 text-sm text-white"
        >
          {toast}
        </div>
      )}

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
