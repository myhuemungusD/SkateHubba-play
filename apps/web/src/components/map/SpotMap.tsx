import { useEffect, useRef, useCallback, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Crosshair, Plus, X } from "lucide-react";
import type { Spot, SpotGeoJSON } from "@shared/types";
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
    /* Keyboard focus ring for spot markers (role=button, tabindex=0) */
    .mapboxgl-marker[role="button"]:focus-visible {
      outline: 2px solid #F97316;
      outline-offset: 3px;
      border-radius: 50%;
    }
    /* Lift Mapbox's built-in bottom controls above the SkateHubba bottom nav
       (which covers roughly the bottom 80px of the viewport on /map) and the
       Add Spot FAB column. */
    .mapboxgl-ctrl-bottom-right {
      bottom: calc(env(safe-area-inset-bottom, 0px) + 11rem) !important;
    }
    .mapboxgl-ctrl-bottom-left {
      bottom: calc(env(safe-area-inset-bottom, 0px) + 5rem) !important;
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
  const abortRef = useRef<AbortController | null>(null);
  const lastBoundsRef = useRef<{ n: number; s: number; e: number; w: number } | null>(null);
  const hasLockedRef = useRef(false);
  // Keep a ref to latest userLocation so callbacks don't go stale
  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null);

  const [spots, setSpots] = useState<Spot[]>([]);
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const [isAddingSpot, setIsAddingSpot] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isTrackingUser, setIsTrackingUser] = useState(true);

  const [gpsError, setGpsError] = useState<string | null>(() =>
    "geolocation" in navigator ? null : "Geolocation not supported by your browser",
  );
  const [gpsErrorDismissed, setGpsErrorDismissed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapLoadError, setMapLoadError] = useState<string | null>(() =>
    MAPBOX_TOKEN ? null : "Map configuration missing. Please try again later.",
  );
  const [spotsFetchError, setSpotsFetchError] = useState<string | null>(null);

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

  // Fetch spots for current bounds
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

        // Cancel previous fetch
        if (abortRef.current) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const params = new URLSearchParams({
          north: n.toString(),
          south: s.toString(),
          east: e.toString(),
          west: w.toString(),
        });

        fetch(`/api/spots/bounds?${params}`, { signal: controller.signal })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json() as Promise<{ type: string; features: SpotGeoJSON[] }>;
          })
          .then((data) => {
            if (!Array.isArray(data.features)) return;
            const spotsList: Spot[] = data.features.map((f: SpotGeoJSON) => f.properties);
            setSpots(spotsList);
            setSpotsFetchError(null);
          })
          .catch((err: Error) => {
            if (err.name !== "AbortError") {
              console.warn("Failed to fetch spots:", err.message);
              setSpotsFetchError("Couldn't load spots. Check your connection.");
            }
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

    if (isActiveGame) {
      const ring = document.createElement("div");
      ring.className = "spot-pulse-ring";
      el.appendChild(ring);
    }

    return el;
  }, []);

  // Initialize map — setState inside the catch/error branches below is
  // intentional: surfacing a Mapbox init failure to the user is exactly the
  // kind of external-system error that must flow back into React state, and
  // there is no external subscription to defer it through.
  /* eslint-disable react-hooks/set-state-in-effect -- map init errors must be
     surfaced to the UI synchronously */
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    // Short-circuit when Mapbox is not configured so the error overlay stays visible
    if (!MAPBOX_TOKEN) return;

    injectPulseCSS();
    mapboxgl.accessToken = MAPBOX_TOKEN;

    let m: mapboxgl.Map;
    try {
      m = new mapboxgl.Map({
        container: mapContainer.current,
        style: MAP_STYLE,
        zoom: MAP_DEFAULTS.zoom,
        minZoom: MAP_DEFAULTS.minZoom,
        maxZoom: MAP_DEFAULTS.maxZoom,
        center: [-118.2437, 34.0522], // Assumption: default to Los Angeles
        attributionControl: false,
      });
    } catch (err) {
      setMapLoadError(err instanceof Error ? err.message : "Failed to load map");
      setMapLoading(false);
      return;
    }

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

    // Surface fatal Mapbox errors (auth failures, tile load issues) to the user
    m.on("error", (e) => {
      const msg = e.error?.message ?? "Map failed to load";
      console.warn("Mapbox error:", msg);
      setMapLoadError(msg);
      setMapLoading(false);
    });

    map.current = m;

    return () => {
      m.remove();
      map.current = null;
    };
  }, [fetchSpots, setIsTrackingUser]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // GPS tracking
  useEffect(() => {
    if (!("geolocation" in navigator)) return;

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        setGpsError(null);
        setGpsErrorDismissed(false);

        // Fly to user on first GPS lock, then user can pan freely
        if (!hasLockedRef.current && map.current) {
          map.current.flyTo({ center: [loc.lng, loc.lat], zoom: 15 });
          hasLockedRef.current = true;
        }
      },
      (err) => {
        setGpsError(getGpsErrorMessage(err));
        setGpsErrorDismissed(false);
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

    // Add new markers
    for (const spot of spots) {
      if (markersRef.current.has(spot.id)) continue;

      const isActiveGame = spot.id === activeGameSpotId;
      const el = createMarkerEl(spot, isActiveGame);

      // Make markers keyboard-accessible for screen readers and non-mouse users
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-label", `Spot: ${spot.name}`);

      const selectSpot = () => {
        setSelectedSpot(spot);
        onSpotSelect?.(spot);
      };
      const clickListener = (e: MouseEvent) => {
        e.stopPropagation();
        selectSpot();
      };
      const keyListener = (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          selectSpot();
        }
      };
      el.addEventListener("click", clickListener);
      el.addEventListener("keydown", keyListener);

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([spot.longitude, spot.latitude])
        .addTo(map.current!);

      markersRef.current.set(spot.id, {
        marker,
        cleanup: () => {
          el.removeEventListener("click", clickListener);
          el.removeEventListener("keydown", keyListener);
        },
      });
    }
  }, [spots, activeGameSpotId, createMarkerEl, setSelectedSpot, onSpotSelect]);

  // Cleanup all timers, controllers, and markers on unmount
  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      if (abortRef.current) abortRef.current.abort();
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
  }, [setIsTrackingUser, showToast]);

  const handleRetryFetch = useCallback(() => {
    if (!map.current) return;
    // Reset the bounds cache so fetchSpots doesn't early-return on identical bounds
    lastBoundsRef.current = null;
    setSpotsFetchError(null);
    fetchSpots(map.current);
  }, [fetchSpots]);

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
      {mapLoading && !mapLoadError && (
        <div
          className="absolute inset-0 z-40 bg-[#0A0A0A] flex items-center justify-center"
          role="status"
          aria-live="polite"
        >
          <div className="text-[#888] text-sm">Loading map…</div>
        </div>
      )}

      {/* Map load error overlay (missing token / tile failure) */}
      {mapLoadError && (
        <div
          className="absolute inset-0 z-40 bg-[#0A0A0A] flex flex-col items-center justify-center px-6 text-center"
          role="alert"
        >
          <p className="text-white text-base font-semibold mb-2">Map unavailable</p>
          <p className="text-[#888] text-sm mb-4">{mapLoadError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-5 py-2 bg-[#F97316] text-white rounded-lg text-sm hover:bg-[#EA580C] transition-colors"
          >
            Reload
          </button>
        </div>
      )}

      {/* GPS error banner (dismissible) */}
      {gpsError && !gpsErrorDismissed && (
        <div
          className="absolute top-4 left-4 right-4 z-30 bg-[#1A1A1A] border border-[#333] rounded-xl px-4 py-3 text-sm text-[#CCC] flex items-start gap-3"
          role="status"
        >
          <span className="flex-1">{gpsError}</span>
          <button
            type="button"
            onClick={() => setGpsErrorDismissed(true)}
            className="text-[#888] hover:text-white shrink-0 -mt-0.5"
            aria-label="Dismiss location error"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Spots fetch error banner with retry */}
      {spotsFetchError && !mapLoading && !mapLoadError && (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-[#1A1A1A] border border-red-500/40 rounded-xl px-4 py-2 text-sm text-[#CCC] flex items-center gap-3"
          role="alert"
        >
          <span>{spotsFetchError}</span>
          <button type="button" onClick={handleRetryFetch} className="text-[#F97316] font-semibold hover:underline">
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!mapLoading && !mapLoadError && !spotsFetchError && spots.length === 0 && (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-[#1A1A1A]/90 backdrop-blur rounded-xl px-4 py-2 text-sm text-[#888]"
          role="status"
        >
          No spots nearby. Add one!
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-[#1A1A1A] border border-[#333] rounded-xl px-4 py-2 text-sm text-white">
          {toast}
        </div>
      )}

      {/* Recenter button — sits above the Add Spot FAB */}
      <button
        type="button"
        onClick={handleRecenter}
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 15rem)" }}
        className="absolute right-2.5 z-20 w-10 h-10 bg-[#1A1A1A] border border-[#333] rounded-lg
                   flex items-center justify-center text-white hover:bg-[#333] transition-colors
                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F97316]"
        aria-label="Recenter to my location"
      >
        <Crosshair size={18} />
      </button>

      {/* Add spot FAB — sits above the app's bottom tab bar */}
      <button
        type="button"
        onClick={() => setIsAddingSpot(true)}
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 8rem)" }}
        className="absolute right-2.5 z-20 w-14 h-14 bg-[#F97316] rounded-full
                   flex items-center justify-center text-white shadow-lg
                   hover:bg-[#EA580C] transition-colors
                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        aria-label="Add a spot"
      >
        <Plus size={26} />
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
