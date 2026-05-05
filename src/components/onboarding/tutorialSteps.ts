/**
 * Onboarding tutorial copy + anchor selectors. The 5 steps run in order; each
 * advance/skip/complete is brokered by useOnboarding. Bumping the script
 * meaningfully should accompany a TUTORIAL_VERSION bump in src/services/onboarding.ts
 * so existing users see the refreshed tour.
 *
 * Anchor selectors are CSS-attribute hooks the orchestrator will sprinkle on
 * existing screens — `data-tutorial="profile-form"`, `"challenge-cta"`,
 * `"record-button"`. Steps without an anchor render the bubble centered.
 */

export interface TutorialStep {
  id: string;
  title: string;
  bubble: string;
  /** CSS selector — when present, SpotlightOverlay highlights this element. */
  anchorSelector?: string;
  primaryCtaLabel: string;
  /** When true, primary CTA fires complete() and a celebratory effect renders. */
  isFinal?: boolean;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "welcome",
    title: "yo, welcome",
    bubble: "i'm Hubz. show you the park real quick?",
    primaryCtaLabel: "let's go",
  },
  {
    id: "handle",
    title: "your tag",
    bubble: "pick a name. that's how everyone'll know you.",
    anchorSelector: '[data-tutorial="profile-form"]',
    primaryCtaLabel: "got it",
  },
  {
    id: "challenge",
    title: "first session",
    bubble: "challenge a friend or hop in quickplay.",
    anchorSelector: '[data-tutorial="challenge-cta"]',
    primaryCtaLabel: "got it",
  },
  {
    id: "record",
    title: "land your first trick",
    bubble: "tap record. land it. bails are part of it.",
    anchorSelector: '[data-tutorial="record-button"]',
    primaryCtaLabel: "got it",
  },
  {
    id: "celebrate",
    title: "you're in",
    bubble: "that's it. clean trick lands on the feed. catch you out there.",
    primaryCtaLabel: "finish",
    isFinal: true,
  },
] as const;

export const TUTORIAL_TOTAL_STEPS = TUTORIAL_STEPS.length;
