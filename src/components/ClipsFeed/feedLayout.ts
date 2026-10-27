import { isFeedModesEnabled, isProCommunityEnabled } from "../../lib/featureFlags";

/** One snapped page in the vertical feed. Height matches the viewport the scroller fills. */
export const FEED_SLIDE = "relative h-full w-full shrink-0 snap-start snap-always bg-black";

/**
 * Clears the fixed bottom nav (`BottomNav` is `z-40` with its own safe-area
 * padding) plus a little air so rail buttons are never under the bar.
 */
export const ABOVE_NAV = "bottom-[calc(6.5rem+env(safe-area-inset-bottom))]";

/**
 * One stacked column pinned under the top safe area: the header row, then the
 * mode switcher, then the Pro Picks pill, then any notices. Every row flows
 * below the one above it, so nothing guesses a fixed `top-16` and lands under
 * the header on a notched phone (the cause of the stray orange underline
 * peeking out of the header row on iPhone Pro Max).
 */
export const FEED_TOP_STACK = "pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col pt-safe";

/** Height of each stacked row: the 44px header row, mode switcher, and Pro Picks pill row. */
export const FEED_TOP_ROW_REM = 2.75;

/**
 * Literal Tailwind classes (the scanner needs full strings) for the first
 * free line under the top stack, keyed by how many optional rows it holds.
 * Each one is the safe area + header row + optional rows + 1.5rem air.
 */
const BELOW_TOP_STACK = [
  "top-[calc(max(env(safe-area-inset-top),1.25rem)+4.25rem)]",
  "top-[calc(max(env(safe-area-inset-top),1.25rem)+7rem)]",
  "top-[calc(max(env(safe-area-inset-top),1.25rem)+9.75rem)]",
] as const;

/** Class that clears a top stack with `extraRows` optional rows (0-2) under the header row. */
export function belowTopStack(extraRows: number): string {
  return BELOW_TOP_STACK[Math.max(0, Math.min(BELOW_TOP_STACK.length - 1, extraRows))];
}

/**
 * Sits under the whole floating top stack, inside the top safe area. The mode
 * switcher and the Pro Picks pill are build-time flags, so this resolves once.
 */
export const BELOW_HEADER = belowTopStack(Number(isFeedModesEnabled()) + Number(isProCommunityEnabled()));

/**
 * Short screens (iPhone SE 1st gen at 320x568, 360x640 Androids) can't fit
 * the six-button rail under the mute toggle. Below 660px tall the rail
 * tightens its gaps and the mute toggle moves to the top-left corner, so the
 * two never overlap and every target stays 44px.
 */
export const RAIL_GAP = "gap-3 [@media(max-height:660px)]:gap-2";
export const MUTE_SIDE = "right-3 [@media(max-height:660px)]:right-auto [@media(max-height:660px)]:left-3";

/** 44px round control shared by the side rail and the mute toggle. */
export const RAIL_BTN =
  "inline-flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-full border border-white/15 bg-black/55 text-white shadow-lg backdrop-blur-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40";

/** How many slides around the active one keep a mounted <video>. */
export const VIDEO_WINDOW = 1;

export function isNearSlide(index: number, activeIndex: number): boolean {
  return Math.abs(index - activeIndex) <= VIDEO_WINDOW;
}
