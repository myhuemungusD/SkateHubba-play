import { useCallback, useEffect, useRef, useState } from "react";
import type * as mapboxgl from "mapbox-gl";
import type { Spot } from "../../types/spot";
import { getSpotsInBounds } from "../../services/spots";
import { logger } from "../../services/logger";

const DEBOUNCE_MS = 400;
const BOUNDS_DELTA_THRESHOLD = 0.001;

interface UseSpotsInBoundsResult {
  spots: Spot[];
  setSpots: React.Dispatch<React.SetStateAction<Spot[]>>;
  fetchSpots: (mapInstance: mapboxgl.Map) => void;
}

/**
 * Owns the debounced viewport-driven Firestore fetch.
 *
 * No AbortController: the Firestore SDK has no native cancellation. Instead
 * each fetch bumps `fetchGenerationRef` so a stale resolver knows to drop
 * its result, which gives us the same "only the latest pan wins" behavior
 * without pretending to cancel in-flight Firestore RPCs.
 */
export function useSpotsInBounds(): UseSpotsInBoundsResult {
  const [spots, setSpots] = useState<Spot[]>([]);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBoundsRef = useRef<{ n: number; s: number; e: number; w: number } | null>(null);
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

  // Clear pending debounce timer on unmount so a late fetch doesn't fire
  // after the map has been removed.
  useEffect(() => {
    return () => {
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    };
  }, []);

  return { spots, setSpots, fetchSpots };
}
