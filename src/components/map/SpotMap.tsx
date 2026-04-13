import { useEffect, useRef, useCallback, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Crosshair, Plus } from "lucide-react";
import type { Spot } from "../../types/spot";
import { getSpotsInBounds } from "../../services/spots";
import { logger } from "../../services/logger";
import { MAPBOX_TOKEN, MAP_STYLE, MAP_DEFAULTS } from "../../lib/mapbox";
import { SpotPreviewCard } from "./SpotPreviewCard";
import { AddSpotSheet } from "./AddSpotSheet";

interface SpotMapProps {
  activeGameSpotId?: string;
  onSpotSelect?: (spot: Spot) => void;
}

// Inject pulsing marker CSS once
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

export function SpotMap({ activeGameSpotId, onSpotSelect }: SpotMapProps) {
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
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const [isAddingSpot, setIsAddingSpot] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isTrackingUser, setIsTrackingUser] = useState(true);

  const [gpsError, setGpsError] = useState<string | null>(() =>
    "geolocation" in navigator ? null : "Geolocation not supported by your browser",
  );
  const [toast, setToast] = useState<string | null>(null);
  const [mapLoading, setMapLoading] = useState(true);

  // Keep ref in sync
  useEffect(() => {
    userLocationRef.current = userLocation;
  }, [userLocation]);

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

    // Initial fetch after load
    m.on("load", () => {
      setMapLoading(false);
      fetchSpots(m);
    });

    map.current = m;

    return () => {
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

  // Update spot markers — track listeners for proper cleanup
  useEffect(() => {
    if (!map.current) return;

    const currentIds = new Set(spots.map((s) => s.id));
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
    for (const spot of spots) {
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
  }, [spots, activeGameSpotId, createMarkerEl, setSelectedSpot, onSpotSelect]);

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

  return (
    <div className="relative w-full" style={{ height: "100dvh" }}>
      <div ref={mapContainer} className="w-full h-full" />

      {/* Map loading overlay */}
      {mapLoading && (
        <div className="absolute inset-0 z-40 bg-[#0A0A0A] flex items-center justify-center">
          <div className="text-[#888] text-sm">Loading map…</div>
        </div>
      )}

      {/* GPS error banner */}
      {gpsError && (
        <div className="absolute top-4 left-4 right-4 z-30 bg-[#1A1A1A] border border-[#333] rounded-xl px-4 py-3 text-sm text-[#CCC]">
          {gpsError}
        </div>
      )}

      {/* Empty state */}
      {!mapLoading && spots.length === 0 && !gpsError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-[#1A1A1A]/90 backdrop-blur rounded-xl px-4 py-2 text-sm text-[#888]">
          No spots nearby. Add one!
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-[#1A1A1A] border border-[#333] rounded-xl px-4 py-2 text-sm text-white">
          {toast}
        </div>
      )}

      {/* Recenter button */}
      <button
        type="button"
        onClick={handleRecenter}
        className="absolute bottom-36 right-2.5 z-20 w-8 h-8 bg-[#1A1A1A] border border-[#333] rounded-lg
                   flex items-center justify-center text-white hover:bg-[#333] transition-colors"
        aria-label="Recenter to my location"
      >
        <Crosshair size={16} />
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
      {selectedSpot && <SpotPreviewCard spot={selectedSpot} onClose={() => setSelectedSpot(null)} />}

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
