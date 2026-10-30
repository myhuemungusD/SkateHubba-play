import { isFeedShareEnabled } from "../../lib/featureFlags";

/** One snapped page in the vertical feed. Height matches the viewport the scroller fills. */
export const FEED_SLIDE = "relative h-full w-full shrink-0 snap-start snap-always bg-black";

/**
 * Clears the fixed bottom nav (`BottomNav` is `z-40` with its own safe-area
 * padding) plus a little air so rail buttons are never under the bar.
 */
export const ABOVE_NAV = "bottom-[calc(6.5rem+env(safe-area-inset-bottom))]";

/** Sits under the floating Top/New header, inside the top safe area. */
export const BELOW_HEADER = "top-[calc(max(env(safe-area-inset-top),1.25rem)+4.25rem)]";

/**
 * Mute toggle side with the feed Share button on (VITE_FEATURE_FEED_SHARE).
 * Share makes the rail six buttons plus the "Challenge" caption: 6×44 + 5×12
 * + 22 = 346px, its bottom 104px (6.5rem) above the screen bottom. The mute
 * toggle sits top-right under the header, bottom edge at 132px (20px safe
 * area + 4.25rem + 44). On a 568px-tall screen (iPhone SE 1st gen) the rail
 * top lands at 118 and covers the toggle; a top-right toggle clears the rail
 * by a full gap from 594px up. At 600px or less the toggle moves top-left,
 * where nothing else sits. feedLayout.test.ts re-derives these numbers from
 * the rendered rail, so a taller header or another rail button fails it.
 */
export const MUTE_SIDE_WITH_SHARE = "right-3 [@media(max-height:600px)]:right-auto [@media(max-height:600px)]:left-3";

/**
 * Where a clip (Spotlight) card's mute toggle sits. With the flag off the rail
 * is the five-button one, which never reaches the toggle, so it stays
 * top-right as before. Clip cards only: a dispute card has no rail on that
 * side, and its info block spans left-4 to right-20, so a top-left toggle
 * would sit on it. Disputes keep SpotlightVideo's right-3 default.
 */
export function clipMuteSide(feedShare: boolean = isFeedShareEnabled()): string {
  return feedShare ? MUTE_SIDE_WITH_SHARE : "right-3";
}

/** 44px round control shared by the side rail and the mute toggle. */
export const RAIL_BTN =
  "inline-flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-full border border-white/15 bg-black/55 text-white shadow-lg backdrop-blur-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-40";

/** How many slides around the active one keep a mounted <video>. */
const VIDEO_WINDOW = 1;

export function isNearSlide(index: number, activeIndex: number): boolean {
  return Math.abs(index - activeIndex) <= VIDEO_WINDOW;
}
