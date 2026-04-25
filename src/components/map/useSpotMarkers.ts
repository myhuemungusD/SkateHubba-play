import { useCallback, useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import type { Spot } from "../../types/spot";

type MarkerEntry = { marker: mapboxgl.Marker; cleanup: () => void };

interface UseSpotMarkersParams {
  map: React.MutableRefObject<mapboxgl.Map | null>;
  visibleSpots: Spot[];
  activeGameSpotId: string | undefined;
  onSpotClick: (spot: Spot) => void;
}

/**
 * Owns the spot-marker diff effect: adds new markers, removes ones that fall
 * out of view, and rebuilds the previously/newly active markers when
 * `activeGameSpotId` changes so the pulse ring updates.
 *
 * The `data-testid="spot-marker-${spot.id}"` hook on each marker is required
 * for the e2e suite; anonymous marker divs are otherwise unselectable
 * without coordinate math.
 */
export function useSpotMarkers({ map, visibleSpots, activeGameSpotId, onSpotClick }: UseSpotMarkersParams): void {
  const markersRef = useRef<Map<string, MarkerEntry>>(new Map());
  // Track the previously-rendered active game spot so we can rebuild the
  // affected markers when it changes (the markers diff below otherwise
  // short-circuits on existing spot ids and never updates the pulse ring).
  const prevActiveSpotRef = useRef<string | undefined>(undefined);

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
        onSpotClick(spot);
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
  }, [map, visibleSpots, activeGameSpotId, createMarkerEl, onSpotClick]);

  // Cleanup all markers on unmount.
  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      for (const entry of markers.values()) {
        entry.cleanup();
        entry.marker.remove();
      }
      markers.clear();
    };
  }, []);
}
