/** One snapped page in the vertical feed. Height matches the viewport the scroller fills. */
export const FEED_SLIDE = "relative h-full w-full shrink-0 snap-start snap-always bg-black";

/**
 * Clears the fixed bottom nav (`BottomNav` is `z-40` with its own safe-area
 * padding) plus a little air so rail buttons are never under the bar.
 */
export const ABOVE_NAV = "bottom-[calc(6.5rem+env(safe-area-inset-bottom))]";

/** Sits under the floating Top/New header, inside the top safe area. */
export const BELOW_HEADER = "top-[calc(max(env(safe-area-inset-top),1.25rem)+4.25rem)]";

/** 44px round control shared by the side rail and the mute toggle. */
export const RAIL_BTN =
  "inline-flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-full border border-white/15 bg-black/55 text-white shadow-lg backdrop-blur-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-40";

/** How many slides around the active one keep a mounted <video>. */
export const VIDEO_WINDOW = 1;

export function isNearSlide(index: number, activeIndex: number): boolean {
  return Math.abs(index - activeIndex) <= VIDEO_WINDOW;
}
