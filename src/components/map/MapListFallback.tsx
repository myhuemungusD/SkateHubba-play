import { useNavigate } from "react-router";
import { NEARBY_RADIUS_KM } from "../../services/spots";
import type { LatLng } from "../../utils/geo";
import { BackChevron } from "../ScreenHeader";
import { NearbySpotsList } from "./NearbySpotsList";
import { useNearbySpots } from "./useNearbySpots";

/**
 * "Use list view" fallback for when the map can't load (blocked tiles, no
 * token, slow network). Lists the closest spots without Mapbox, the way
 * Strava falls back to a segment list (design audit #31). Tapping a spot
 * opens its detail page, which works without the map.
 */
export function MapListFallback({ userLocation, onBack }: { userLocation: LatLng | null; onBack: () => void }) {
  const navigate = useNavigate();
  const { status, spots } = useNearbySpots(userLocation, true);
  return (
    <section
      aria-labelledby="map-list-heading"
      className="absolute inset-0 z-40 overflow-y-auto bg-background px-4 pt-safe pb-tabbar"
      data-testid="map-list-fallback"
    >
      <div className="flex items-center gap-2 py-2">
        <BackChevron onClick={onBack} label="Back to map" />
        <h2 id="map-list-heading" className="font-display text-2xl tracking-wide text-white">
          Spots near you
        </h2>
      </div>
      <NearbySpotsList
        status={status}
        spots={spots}
        radiusKm={NEARBY_RADIUS_KM}
        onSelect={(spot) => void navigate(`/spots/${spot.id}`)}
      />
    </section>
  );
}
