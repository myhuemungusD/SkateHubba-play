import { useEffect, useRef, useState } from "react";
import { getSpotsNearby, type NearbySpot } from "../../services/spots";
import { logger } from "../../services/logger";
import { haversineKm, type LatLng } from "../../utils/geo";

/**
 * A GPS fix inside this distance of the last fetch reuses the cached list.
 * `watchPosition` emits on every satellite jitter; without this guard each
 * tick would cost a Firestore query while the dropdown is open.
 */
const REFETCH_DISTANCE_KM = 0.25;

export type NearbyStatus = "idle" | "no-gps" | "loading" | "error" | "ready";

interface UseNearbySpotsResult {
  status: NearbyStatus;
  spots: NearbySpot[];
}

interface NearbyResult {
  spots: NearbySpot[];
  /** The fix the fetch was issued for. */
  at: LatLng;
  error: boolean;
}

/**
 * Fetches the closest spots to `userLocation` while `enabled` is true.
 *
 * Status is derived from the last settled result rather than stored, so the
 * effect only ever sets state from the (async) promise callbacks. A failed
 * fetch is remembered for the exact fix it was issued against; the next GPS
 * tick (a new object) retries automatically.
 *
 * Generation-counted like `useSpotsInBounds`: the Firestore SDK has no
 * cancellation, so a stale resolver just drops its result.
 */
export function useNearbySpots(userLocation: LatLng | null, enabled: boolean): UseNearbySpotsResult {
  const [result, setResult] = useState<NearbyResult | null>(null);
  const generationRef = useRef(0);

  const fresh =
    result !== null &&
    userLocation !== null &&
    (result.error ? result.at === userLocation : haversineKm(result.at, userLocation) < REFETCH_DISTANCE_KM);

  useEffect(() => {
    if (!enabled || !userLocation || fresh) return;

    const generation = ++generationRef.current;
    getSpotsNearby(userLocation)
      .then((list) => {
        if (generation !== generationRef.current) return;
        setResult({ spots: list, at: userLocation, error: false });
      })
      .catch((err: unknown) => {
        if (generation !== generationRef.current) return;
        logger.warn("fetch_nearby_spots_failed", {
          error: err instanceof Error ? err.message : "unknown",
        });
        setResult({ spots: [], at: userLocation, error: true });
      });
  }, [enabled, userLocation, fresh]);

  let status: NearbyStatus;
  if (!enabled) status = "idle";
  else if (!userLocation) status = "no-gps";
  else if (!fresh) status = "loading";
  else status = result.error ? "error" : "ready";

  return { status, spots: fresh && !result.error ? result.spots : [] };
}
