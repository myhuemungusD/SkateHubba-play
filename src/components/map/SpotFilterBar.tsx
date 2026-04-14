import { useState, useCallback, useRef, useEffect } from "react";
import { Search, SlidersHorizontal, X, BadgeCheck } from "lucide-react";
import type { Spot, ObstacleType } from "../../types/spot";

/**
 * Top-of-map filter + search bar.
 *
 * Competitor audit: the #1 user complaint on ShredSpots/Smap is "junk" spots
 * cluttering the map with no way to filter them out, and no name/address
 * search so users are forced to pan. This bar closes both gaps with a pure
 * client-side filter (no extra Firestore reads) that operates on the spots
 * already fetched by the viewport query.
 */

export interface SpotFilters {
  /** Case-insensitive substring match on `spot.name`. Trimmed before compare. */
  query: string;
  /** OR-match: spot passes if it has ANY of these obstacles (empty = no filter). */
  obstacles: ObstacleType[];
  /** If true, only verified spots pass. */
  verifiedOnly: boolean;
  /** Minimum gnar rating. 0 means no threshold. */
  minGnar: 0 | 3 | 4 | 5;
}

export const DEFAULT_SPOT_FILTERS: SpotFilters = {
  query: "",
  obstacles: [],
  verifiedOnly: false,
  minGnar: 0,
};

const FILTERABLE_OBSTACLES: readonly ObstacleType[] = [
  "ledge",
  "rail",
  "stairs",
  "gap",
  "bank",
  "bowl",
  "manual_pad",
  "quarter_pipe",
  "hubba",
  "hip",
  "flatground",
] as const;

/**
 * Pure filter — exported so tests (and any future list view) can exercise the
 * exact same logic the map uses to decide which markers to render.
 */
export function applySpotFilters(spots: Spot[], f: SpotFilters): Spot[] {
  const q = f.query.trim().toLowerCase();
  const hasObstacleFilter = f.obstacles.length > 0;
  return spots.filter((s) => {
    if (q.length > 0 && !s.name.toLowerCase().includes(q)) return false;
    if (f.verifiedOnly && !s.isVerified) return false;
    if (f.minGnar > 0 && s.gnarRating < f.minGnar) return false;
    if (hasObstacleFilter && !f.obstacles.some((o) => s.obstacles.includes(o))) return false;
    return true;
  });
}

export function countActiveFilters(f: SpotFilters): number {
  let n = 0;
  if (f.obstacles.length > 0) n += 1;
  if (f.verifiedOnly) n += 1;
  if (f.minGnar > 0) n += 1;
  return n;
}

interface SpotFilterBarProps {
  filters: SpotFilters;
  onChange: (next: SpotFilters) => void;
  /** Number of spots currently in the viewport (pre-filter). */
  totalCount: number;
  /** Number of spots after filters (post-filter). */
  matchCount: number;
}

export function SpotFilterBar({ filters, onChange, totalCount, matchCount }: SpotFilterBarProps) {
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const active = countActiveFilters(filters);
  const isFiltering = active > 0 || filters.query.trim().length > 0;

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

  // Close the panel when the user taps outside of it (common mobile expectation
  // — a filter sheet that won't dismiss is an unintentional modal trap).
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (panelRef.current && target && !panelRef.current.contains(target)) {
        setExpanded(false);
      }
    };
    // Capture phase so we see the tap before map/marker handlers eat it.
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [expanded]);

  return (
    <div ref={panelRef} className="absolute top-3 left-3 right-3 z-30 pointer-events-none">
      {/* Search + filter toggle row */}
      <div className="flex items-center gap-2 pointer-events-auto">
        <label className="flex-1 flex items-center gap-2 bg-[#1A1A1A]/95 backdrop-blur border border-[#333] rounded-xl px-3 h-10">
          <Search size={16} className="text-[#888] flex-shrink-0" aria-hidden="true" />
          <input
            type="search"
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            placeholder="Search spots in view"
            aria-label="Search spots in current map view"
            className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder:text-[#666] focus:outline-none"
          />
          {filters.query.length > 0 && (
            <button
              type="button"
              onClick={() => onChange({ ...filters, query: "" })}
              aria-label="Clear search"
              className="text-[#888] hover:text-white"
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
                          ? "bg-[#F97316] border-[#F97316] text-white"
                          : "bg-[#1A1A1A]/95 backdrop-blur border-[#333] text-[#CCC] hover:bg-[#222]"
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

      {/* Result counter — only when a filter or query is active, so the resting
          map stays uncluttered. */}
      {isFiltering && totalCount > 0 && (
        <div
          className="mt-2 inline-block pointer-events-auto bg-[#1A1A1A]/90 backdrop-blur border border-[#333]
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
              className="ml-2 text-[#F97316] hover:underline"
              aria-label="Clear all filters"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Expanded filter panel */}
      {expanded && (
        <div
          id="spot-filter-panel"
          role="region"
          aria-label="Spot filters"
          className="mt-2 pointer-events-auto bg-[#1A1A1A]/95 backdrop-blur border border-[#333] rounded-xl p-3
                     max-h-[55dvh] overflow-y-auto shadow-2xl"
        >
          {/* Obstacles */}
          <div>
            <div className="text-xs text-[#888] mb-2 font-medium">Obstacles</div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERABLE_OBSTACLES.map((o) => {
                const on = filters.obstacles.includes(o);
                return (
                  <button
                    key={o}
                    type="button"
                    onClick={() => toggleObstacle(o)}
                    aria-pressed={on}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                      on
                        ? "bg-[#F97316] border-[#F97316] text-white"
                        : "bg-transparent border-[#444] text-[#BBB] hover:border-[#666]"
                    }`}
                  >
                    {o.replace("_", " ")}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Min gnar */}
          <div className="mt-3">
            <div className="text-xs text-[#888] mb-2 font-medium">Minimum gnar</div>
            <div className="flex gap-1.5">
              {([0, 3, 4, 5] as const).map((v) => {
                const on = filters.minGnar === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => onChange({ ...filters, minGnar: v })}
                    aria-pressed={on}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                      on
                        ? "bg-[#F97316] border-[#F97316] text-white"
                        : "bg-transparent border-[#444] text-[#BBB] hover:border-[#666]"
                    }`}
                  >
                    {v === 0 ? "Any" : `${v}+`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Verified only */}
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BadgeCheck size={16} className="text-[#22C55E]" aria-hidden="true" />
              <span className="text-sm text-[#CCC]">Verified spots only</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={filters.verifiedOnly}
              onClick={() => onChange({ ...filters, verifiedOnly: !filters.verifiedOnly })}
              className={`relative w-10 h-6 rounded-full transition-colors ${
                filters.verifiedOnly ? "bg-[#F97316]" : "bg-[#333]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                  filters.verifiedOnly ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Footer */}
          <div className="mt-4 flex justify-between items-center">
            <button
              type="button"
              onClick={reset}
              disabled={active === 0 && filters.query.length === 0}
              className="text-xs text-[#888] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="px-4 py-1.5 text-xs rounded-lg bg-[#F97316] text-white font-semibold hover:bg-[#EA580C]"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
