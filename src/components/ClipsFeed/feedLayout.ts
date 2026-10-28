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
 * Which side the mute toggle sits on. On short screens it would land on the
 * clip rail: with the mode switcher and Pro Picks rows on (the iOS build), the
 * toggle ends 220px down, and on a 568px-tall screen (iPhone SE 1st gen) the
 * five-button rail (thumbs up, thumbs down, comments, challenge, report) starts
 * at 196px. At 620px tall or less the toggle moves to the top-left corner, away
 * from the rail. Taller screens keep it top-right, where the rail clears it by
 * at least 29px. The rail itself is unchanged, so every target stays 44px.
 * feedLayout.test.ts re-derives the 620px breakpoint from the rail, so adding
 * a rail button fails that test until this is re-sized.
 *
 * Clip (Spotlight) cards only. A dispute card has no five-button rail, and its
 * info block (call pill, trick name, tally) spans the top-left from left-4 to
 * right-20, so its toggle stays at SpotlightVideo's default top-right.
 */
export const MUTE_SIDE = "right-3 [@media(max-height:620px)]:right-auto [@media(max-height:620px)]:left-3";

/** 44px round control shared by the side rail and the mute toggle. */
export const RAIL_BTN =
  "inline-flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-full border border-white/15 bg-black/55 text-white shadow-lg backdrop-blur-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-40";

/** How many slides around the active one keep a mounted <video>. */
export const VIDEO_WINDOW = 1;

export function isNearSlide(index: number, activeIndex: number): boolean {
  return Math.abs(index - activeIndex) <= VIDEO_WINDOW;
}
