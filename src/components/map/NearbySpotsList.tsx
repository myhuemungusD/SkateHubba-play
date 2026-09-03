import { MapPin, BadgeCheck } from "lucide-react";
import type { NearbySpot } from "../../services/spots";
import { formatDistance } from "../../utils/geo";
import type { NearbyStatus } from "./useNearbySpots";

interface NearbySpotsListProps {
  status: NearbyStatus;
  /** Already run through the active chip filters by the caller. */
  spots: NearbySpot[];
  /** True when nearby spots exist but every one is hidden by a chip filter. */
  hiddenByFilters?: boolean;
  radiusKm: number;
  onSelect: (spot: NearbySpot) => void;
}

/**
 * Dropdown under the map search box listing the closest spots to the user.
 * Purely presentational — `useNearbySpots` owns the fetch.
 *
 * Deliberately a plain list of buttons rather than an ARIA combobox: the
 * search input is not the thing being navigated, and a listbox without
 * arrow-key handling is worse for assistive tech than an honest list.
 */
export function NearbySpotsList({ status, spots, hiddenByFilters = false, radiusKm, onSelect }: NearbySpotsListProps) {
  const panel =
    "mt-2 pointer-events-auto bg-surface-alt/95 backdrop-blur border border-[#333] rounded-xl shadow-2xl overflow-hidden";

  if (status === "idle") return null;

  if (status !== "ready") {
    const copy =
      status === "no-gps"
        ? "Turn on location to see spots near you"
        : status === "loading"
          ? "Finding spots near you…"
          : "Couldn't load nearby spots. Try again.";
    return (
      <div
        className={`${panel} px-3 py-3 text-sm text-[#CCC]`}
        role="status"
        aria-live="polite"
        data-testid="nearby-status"
      >
        {copy}
      </div>
    );
  }

  if (spots.length === 0) {
    return (
      <div
        className={`${panel} px-3 py-3 text-sm text-[#CCC]`}
        role="status"
        aria-live="polite"
        data-testid="nearby-status"
      >
        {hiddenByFilters
          ? "Nearby spots are hidden by your filters. Loosen them to see more."
          : `No spots within ${radiusKm} km. Be the first to add one.`}
      </div>
    );
  }

  return (
    <div className={`${panel} max-h-[50dvh] overflow-y-auto`}>
      <div className="px-3 pt-2 pb-1 text-xs text-muted font-medium">Near you</div>
      <ul aria-label="Spots near you" className="pb-1">
        {spots.map((spot) => (
          <li key={spot.id}>
            <button
              type="button"
              onClick={() => onSelect(spot)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[#222] transition-colors"
            >
              <MapPin size={16} className="text-[#F97316] flex-shrink-0" aria-hidden="true" />
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm text-white truncate">{spot.name}</span>
                  {spot.isVerified && (
                    <BadgeCheck size={14} className="text-[#22C55E] flex-shrink-0" aria-label="Verified" />
                  )}
                </span>
                {spot.obstacles.length > 0 && (
                  <span className="block text-xs text-muted truncate">
                    {spot.obstacles
                      .slice(0, 3)
                      .map((o) => o.replace("_", " "))
                      .join(" · ")}
                  </span>
                )}
              </span>
              <span className="text-xs text-[#CCC] tabular-nums flex-shrink-0">{formatDistance(spot.distanceKm)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
