/**
 * Onboarding tutorial copy + anchor selectors. The 5 steps run in order; each
 * advance/skip/complete is brokered by useOnboarding. Bumping the script
 * meaningfully should accompany a TUTORIAL_VERSION bump in src/services/onboarding.ts
 * so existing users see the refreshed tour.
 *
 * The new tour is rendered as a small non-blocking coach mark (mascot + speech
 * bubble) anchored above the bottom nav. Anchor selectors are CSS-attribute
 * hooks the orchestrator sprinkles on existing screens; when present, the
 * overlay paints a pulsing ring around the target instead of dimming the whole
 * screen, so the underlying UI stays interactive.
 */

import type { Screen } from "../../context/NavigationContext";

export interface TutorialStep {
  id: string;
  title: string;
  bubble: string;
  /** Encouraging copy shown if the user taps Skip from this step. */
  skipMessage: string;
  /** CSS selector — when present, SpotlightOverlay paints a pulsing ring on this element. */
  anchorSelector?: string;
  primaryCtaLabel: string;
  /** When true, primary CTA fires complete() and a celebratory effect renders. */
  isFinal?: boolean;
  /**
   * Screen the anchor element lives on. If the user navigates away to a
   * different screen the overlay pauses (does not unmount the state). `null`
   * means "any signed-in screen" — used for welcome/celebrate steps with no
   * spatial anchor.
   */
  screen: Screen | null;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "welcome",
    title: "welcome",
    bubble: "quick tour? takes ten seconds.",
    skipMessage: "park's always open.",
    primaryCtaLabel: "show me",
    screen: null,
  },
  {
    id: "handle",
    title: "your tag",
    bubble: "this is the name everyone sees.",
    skipMessage: "you can change it later.",
    anchorSelector: '[data-tutorial="handle-display"]',
    primaryCtaLabel: "next",
    screen: "lobby",
  },
  {
    id: "challenge",
    title: "start a session",
    bubble: "challenge a friend, or hop in quickplay.",
    skipMessage: "no pressure.",
    anchorSelector: '[data-tutorial="challenge-cta"]',
    primaryCtaLabel: "next",
    screen: "lobby",
  },
  {
    id: "record",
    title: "land it",
    bubble: "tap to record. bails count too.",
    skipMessage: "everyone bails.",
    anchorSelector: '[data-tutorial="record-button"]',
    primaryCtaLabel: "next",
    screen: "lobby",
  },
  {
    id: "celebrate",
    title: "you're set",
    bubble: "clean lands hit the feed. catch you out there.",
    skipMessage: "saved as a draft.",
    primaryCtaLabel: "let's skate",
    isFinal: true,
    screen: null,
  },
] as const;

export const TUTORIAL_TOTAL_STEPS = TUTORIAL_STEPS.length;
