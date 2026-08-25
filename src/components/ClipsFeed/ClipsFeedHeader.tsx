import { memo } from "react";
import type { ClipsFeedSort } from "../../services/clips";
import { CameraIcon } from "../icons";
import { TopNewToggle } from "./TopNewToggle";

export interface ClipsFeedHeaderProps {
  sort: ClipsFeedSort;
  onSortChange: (sort: ClipsFeedSort) => void;
  /** Disables the Top/New toggle (e.g. while a fetch is in flight). */
  disabled?: boolean;
  /** Position pill ("3/12"). Omitted while loading or when the pool is empty. */
  position?: { index: number; total: number };
  /** Opens the user-clip upload modal. */
  onPostClip: () => void;
}

/**
 * Header strip above the ClipsFeed spotlight. Holds the FEED label, the
 * position pill (current/total), and the Top/New toggle.
 *
 * Lives next to ClipsFeed/index.tsx so the parent stays close to the 250 LOC
 * component budget after the toggle was added.
 */
export const ClipsFeedHeader = memo(function ClipsFeedHeader({
  sort,
  onSortChange,
  disabled,
  position,
  onPostClip,
}: ClipsFeedHeaderProps) {
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
      <div className="flex items-center gap-2">
        {/* Posting lives in the feed header rather than the lobby's main CTA
            column: it's the same surface you're already browsing, and the
            lobby's primary action is starting a game, which this must not
            compete with. */}
        <button
          type="button"
          onClick={onPostClip}
          aria-label="Post a clip to the feed"
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-brand-orange/30 bg-brand-orange/[0.08] px-3 font-display text-[11px] tracking-[0.15em] text-brand-orange transition-all duration-300 hover:bg-brand-orange/15 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          <CameraIcon size={13} />
          POST
        </button>
        <TopNewToggle sort={sort} onChange={onSortChange} disabled={disabled} />
      </div>
    </div>
  );
});
