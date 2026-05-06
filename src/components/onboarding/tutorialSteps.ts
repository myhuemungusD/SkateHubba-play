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

export interface TutorialStep {
  id: string;
  title: string;
  bubble: string;
  /** CSS selector — when present, SpotlightOverlay paints a pulsing ring on this element. */
  anchorSelector?: string;
  primaryCtaLabel: string;
  /** When true, primary CTA fires complete() and a celebratory effect renders. */
  isFinal?: boolean;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "welcome",
    title: "welcome",
    bubble: "quick tour? takes ten seconds.",
    primaryCtaLabel: "show me",
  },
  {
    id: "handle",
    title: "your tag",
    bubble: "this is the name everyone sees.",
    anchorSelector: '[data-tutorial="profile-form"]',
    primaryCtaLabel: "next",
  },
  {
    id: "challenge",
    title: "start a session",
    bubble: "challenge a friend, or hop in quickplay.",
    anchorSelector: '[data-tutorial="challenge-cta"]',
    primaryCtaLabel: "next",
  },
  {
    id: "record",
    title: "land it",
    bubble: "tap to record. bails count too.",
    anchorSelector: '[data-tutorial="record-button"]',
    primaryCtaLabel: "next",
  },
  {
    id: "celebrate",
    title: "you're set",
    bubble: "clean lands hit the feed. catch you out there.",
    primaryCtaLabel: "let's skate",
    isFinal: true,
  },
] as const;

export const TUTORIAL_TOTAL_STEPS = TUTORIAL_STEPS.length;
