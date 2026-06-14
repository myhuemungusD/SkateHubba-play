/**
 * Single source of truth for the onboarding overlay's z-index, as a Tailwind
 * utility class. Both SpotlightOverlay and TutorialOverlay (ghost-letter)
 * reference this so the stacking is in lockstep — bumping this constant alone
 * moves the entire tour layer.
 *
 * Expressed as a class (not an inline `style={{ zIndex }}`) so the CSP
 * `style-src` can drop `'unsafe-inline'`.
 */
export const Z_TUTORIAL_OVERLAY_CLASS = "z-[60]" as const;
