/**
 * Mirror of src/lib/featureFlags.ts for the E2E runner.
 *
 * playwright.config.ts spreads `process.env` into the Vite dev server, so the
 * same `VITE_FEATURE_EXTRAS_ENABLED` value that gates the app also decides
 * whether specs for the frozen extras (Map, Clips feed, Verified Pro) run.
 * playwright.config.ts turns the flag on so the suite matches production
 * (the community vote lives on the Clips feed). Set the env var to "false"
 * to run the core loop only.
 *
 *   VITE_FEATURE_EXTRAS_ENABLED=false npm run test:e2e   → skip Map / Clips
 */
export const EXTRAS_ENABLED = process.env.VITE_FEATURE_EXTRAS_ENABLED === "true";

/** Roll Dice stays off unless the dev server was started with the flag. */
export const DICE_ENABLED = process.env.VITE_FEATURE_DICE_ENABLED === "true";

export const EXTRAS_SKIP_REASON =
  "Feature freeze: Map / Clips feed / Verified Pro are hidden unless VITE_FEATURE_EXTRAS_ENABLED=true";
