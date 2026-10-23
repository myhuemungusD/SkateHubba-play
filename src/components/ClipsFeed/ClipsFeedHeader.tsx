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
 * Camera is the one create action here. Editing lives on your own clips
 * (profile → pinned clip → Edit) so the feed never shows two look-alike
 * buttons.
 *
 * Header row of the feed's top stack (see `FEED_TOP_STACK`); the stack owns
 * the safe-area padding so every row under it lines up.
 *
 * Floating header over the full-screen feed. The Top/New toggle, post action,
 * and position stay reachable without taking a row away from the video.
 */
export const ClipsFeedHeader = memo(function ClipsFeedHeader({
  sort,
  onSortChange,
  disabled,
  position,
  onPostClip,
}: ClipsFeedHeaderProps) {
  return (
    <div
      data-testid="clips-feed-header"
      className="pointer-events-none flex min-h-11 items-center justify-between gap-2 px-3"
    >
      <div className="pointer-events-auto flex items-center gap-2">
        <h2 className="font-display text-[11px] tracking-[0.2em] text-white drop-shadow">CLIPS</h2>
        {position && (
          <span className="rounded bg-black/50 px-1.5 py-0.5 font-display text-[11px] leading-none tabular-nums text-white/80">
            {position.index + 1}/{position.total}
          </span>
        )}
      </div>
      <div className="pointer-events-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onPostClip}
          aria-label="Post a clip to the feed"
          data-tutorial="feed-camera"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-black/50 px-3 font-display text-[11px] tracking-[0.15em] text-white backdrop-blur-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          <CameraIcon size={14} />
          <span className="sr-only sm:not-sr-only">POST</span>
        </button>
        <TopNewToggle sort={sort} onChange={onSortChange} disabled={disabled} />
      </div>
    </div>
  );
});
