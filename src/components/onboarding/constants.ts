/**
 * Single source of truth for the onboarding overlay's z-index. Both
 * SpotlightOverlay and TutorialOverlay (confetti, ghost-letter) reference
 * this so the stacking is in lockstep — bumping this constant alone moves
 * the entire tour layer.
 */
export const Z_TUTORIAL_OVERLAY = 60 as const;
