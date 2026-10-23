import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { SpotFilterPanel } from "./SpotFilterPanel";
import type { ObstacleType } from "../../types/spot";
import { DEFAULT_SPOT_FILTERS, applySpotFilters, countActiveFilters, type SpotFilters } from "./spotFilters";
import { NEARBY_RADIUS_KM, type NearbySpot } from "../../services/spots";
import type { LatLng } from "../../utils/geo";
import { useNearbySpots } from "./useNearbySpots";
import { NearbySpotsList } from "./NearbySpotsList";

/**
 * Top-of-map filter + search bar.
 *
 * Competitor audit: the #1 user complaint on ShredSpots/Smap is "junk" spots
 * cluttering the map with no way to filter them out, and no name/address
 * search so users are forced to pan. This bar closes both gaps with a pure
 * client-side filter (no extra Firestore reads) that operates on the spots
 * already fetched by the viewport query.
 *
 * Focusing the search box with an empty query drops down the closest spots
 * to the user's GPS position (one radius-bounded Firestore read, see
 * `useNearbySpots`). Typing switches back to the name filter.
 */

export { DEFAULT_SPOT_FILTERS, applySpotFilters, countActiveFilters, type SpotFilters } from "./spotFilters";

interface SpotFilterBarProps {
  filters: SpotFilters;
  onChange: (next: SpotFilters) => void;
  /** Number of spots currently in the viewport (pre-filter). */
  totalCount: number;
  /** Number of spots after filters (post-filter). */
  matchCount: number;
  /** Current GPS fix; null until the first lock (or when denied). */
  userLocation?: LatLng | null;
  /** Fired when the user taps a row in the nearby dropdown. */
  onSelectNearby?: (spot: NearbySpot) => void;
}

export function SpotFilterBar({
  filters,
  onChange,
  totalCount,
  matchCount,
  userLocation = null,
  onSelectNearby,
}: SpotFilterBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const active = countActiveFilters(filters);
  const isFiltering = active > 0 || filters.query.trim().length > 0;
  const showNearby = searchFocused && !expanded && filters.query.trim().length === 0;
  const nearby = useNearbySpots(userLocation, showNearby);
  // The dropdown honours the same chip filters as the markers, otherwise a
  // "Verified only" user could pick an unverified row and land on a card
  // with no pin under it.
  const nearbySpots = useMemo(() => applySpotFilters(nearby.spots, filters), [nearby.spots, filters]);

  const toggleObstacle = useCallback(
    (o: ObstacleType) => {
      const next = filters.obstacles.includes(o) ? filters.obstacles.filter((x) => x !== o) : [...filters.obstacles, o];
      onChange({ ...filters, obstacles: next });
    },
    [filters, onChange],
  );

  const reset = useCallback(() => {
    onChange(DEFAULT_SPOT_FILTERS);
    setExpanded(false);
  }, [onChange]);

  const closeNearby = useCallback(() => {
    setSearchFocused(false);
    inputRef.current?.blur();
  }, []);

  const selectNearby = useCallback(
    (spot: NearbySpot) => {
      closeNearby();
      onSelectNearby?.(spot);
    },
    [closeNearby, onSelectNearby],
  );

  // Close the panel / nearby list when the user taps outside of it (common
  // mobile expectation — a filter sheet that won't dismiss is an
  // unintentional modal trap).
  useEffect(() => {
    if (!expanded && !searchFocused) return;
    const handler = (e: Event) => {
      const target = e.target as Node | null;
      if (panelRef.current && target && !panelRef.current.contains(target)) {
        setExpanded(false);
        setSearchFocused(false);
        // Drop DOM focus too, otherwise the next tap on the (still focused)
        // input fires no focus event and the list can't reopen.
        inputRef.current?.blur();
      }
    };
    // Capture phase so we see the tap before map/marker handlers eat it.
    // Mapbox preventDefaults touch gestures on the canvas, which suppresses
    // the synthesized mousedown — listen to touchstart too.
    document.addEventListener("mousedown", handler, true);
    document.addEventListener("touchstart", handler, true);
    return () => {
      document.removeEventListener("mousedown", handler, true);
      document.removeEventListener("touchstart", handler, true);
    };
  }, [expanded, searchFocused]);

  return (
    <div ref={panelRef} className="absolute top-3 left-3 right-3 z-30 pointer-events-none">
      {/* Search + filter toggle row */}
      <div className="flex items-center gap-2 pointer-events-auto">
        <label className="flex-1 flex items-center gap-2 bg-surface-alt/95 backdrop-blur border border-[#333] rounded-xl px-3 h-10">
          <Search size={16} className="text-muted flex-shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            onFocus={() => setSearchFocused(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeNearby();
            }}
            placeholder="Search spots or find nearby"
            aria-label="Search spots in view or find spots near you"
            className="flex-1 min-w-0 bg-transparent text-base text-white placeholder:text-faint focus:outline-none"
          />
          {filters.query.length > 0 && (
            <button
              type="button"
              onClick={() => onChange({ ...filters, query: "" })}
              aria-label="Clear search"
              className="text-muted hover:text-white"
            >
              <X size={14} />
            </button>
          )}
        </label>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="spot-filter-panel"
          aria-label={active > 0 ? `Filters (${active} active)` : "Filters"}
          className={`relative h-10 min-w-[40px] px-3 rounded-xl border flex items-center justify-center
                      transition-colors ${
                        active > 0
                          ? "bg-brand-orange border-brand-orange text-black"
                          : "bg-surface-alt/95 backdrop-blur border-[#333] text-[#CCC] hover:bg-[#222]"
                      }`}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          {active > 0 && (
            <span className="ml-1.5 text-xs font-semibold tabular-nums" aria-hidden="true" data-testid="filter-count">
              {active}
            </span>
          )}
        </button>
      </div>

      {/* Nearby dropdown — search box focused with nothing typed. */}
      {showNearby && (
        <NearbySpotsList
          status={nearby.status}
          spots={nearbySpots}
          hiddenByFilters={nearby.spots.length > 0 && nearbySpots.length === 0}
          radiusKm={NEARBY_RADIUS_KM}
          onSelect={selectNearby}
        />
      )}

      {/* Result counter — only when a filter or query is active, so the resting
          map stays uncluttered. */}
      {isFiltering && totalCount > 0 && (
        <div
          className="mt-2 inline-block pointer-events-auto bg-surface-alt/90 backdrop-blur border border-[#333]
                     rounded-full px-3 py-1 text-xs text-[#CCC]"
          role="status"
          aria-live="polite"
          data-testid="filter-result-count"
        >
          {matchCount} of {totalCount} {totalCount === 1 ? "spot" : "spots"}
          {active > 0 && (
            <button
              type="button"
              onClick={reset}
              className="ml-2 text-brand-orange hover:underline"
              aria-label="Clear all filters"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Expanded filter panel */}
      {expanded && (
        <SpotFilterPanel
          filters={filters}
          onChange={onChange}
          active={active}
          toggleObstacle={toggleObstacle}
          reset={reset}
          onDone={() => setExpanded(false)}
        />
      )}
    </div>
  );
}
