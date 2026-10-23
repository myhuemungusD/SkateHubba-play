import { BadgeCheck } from "lucide-react";
import type { ObstacleType } from "../../types/spot";
import { FILTERABLE_OBSTACLES, type SpotFilters } from "./spotFilters";

interface SpotFilterPanelProps {
  filters: SpotFilters;
  onChange: (next: SpotFilters) => void;
  /** Number of active chip filters (drives the Reset disabled state). */
  active: number;
  toggleObstacle: (o: ObstacleType) => void;
  reset: () => void;
  onDone: () => void;
}

/** Expanded chip panel under the spot search bar: obstacles, gnar, verified. */
export function SpotFilterPanel({ filters, onChange, active, toggleObstacle, reset, onDone }: SpotFilterPanelProps) {
  return (
    <div
      id="spot-filter-panel"
      role="region"
      aria-label="Spot filters"
      className="mt-2 pointer-events-auto bg-surface-alt/95 backdrop-blur border border-[#333] rounded-xl p-3
                 max-h-[55dvh] overflow-y-auto shadow-2xl"
    >
      {/* Obstacles */}
      <div>
        <div className="text-xs text-muted mb-2 font-medium">Obstacles</div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERABLE_OBSTACLES.map((o) => {
            const on = filters.obstacles.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => toggleObstacle(o)}
                aria-pressed={on}
                className={`touch-target inline-flex items-center justify-center px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  on
                    ? "bg-brand-orange border-brand-orange text-black"
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
        <div className="text-xs text-muted mb-2 font-medium">Minimum gnar</div>
        <div className="flex gap-1.5">
          {([0, 3, 4, 5] as const).map((v) => {
            const on = filters.minGnar === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => onChange({ ...filters, minGnar: v })}
                aria-pressed={on}
                className={`touch-target inline-flex items-center justify-center px-3 py-1 text-xs rounded-full border transition-colors ${
                  on
                    ? "bg-brand-orange border-brand-orange text-black"
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
            filters.verifiedOnly ? "bg-brand-orange" : "bg-[#333]"
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
          className="touch-target inline-flex items-center justify-center text-xs text-muted hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={onDone}
          className="touch-target inline-flex items-center justify-center px-4 py-1.5 text-xs rounded-lg bg-brand-orange text-black font-semibold hover:bg-brand-orange-hover"
        >
          Done
        </button>
      </div>
    </div>
  );
}
