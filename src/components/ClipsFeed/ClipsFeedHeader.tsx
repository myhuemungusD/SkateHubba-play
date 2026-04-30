import type { ClipsFeedSort } from "../../services/clips";
import { TopNewToggle } from "./TopNewToggle";

export interface ClipsFeedHeaderProps {
  sort: ClipsFeedSort;
  onSortChange: (sort: ClipsFeedSort) => void;
  /** Disables the Top/New toggle (e.g. while a fetch is in flight). */
  disabled?: boolean;
  /** Position pill ("3/12"). Omitted while loading or when the pool is empty. */
  position?: { index: number; total: number };
}

/**
 * Header strip above the ClipsFeed spotlight. Holds the FEED label, the
 * position pill (current/total), and the Top/New toggle.
 *
 * Lives next to ClipsFeed/index.tsx so the parent stays close to the 250 LOC
 * component budget after the toggle was added.
 */
export function ClipsFeedHeader({ sort, onSortChange, disabled, position }: ClipsFeedHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2">
        <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">FEED</h3>
        {position && (
          <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
            {position.index + 1}/{position.total}
          </span>
        )}
      </div>
      <TopNewToggle sort={sort} onChange={onSortChange} disabled={disabled} />
    </div>
  );
}
