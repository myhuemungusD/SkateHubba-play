/**
 * Mirror of src/lib/featureFlags.ts for the E2E runner.
 *
 * playwright.config.ts spreads `process.env` into the Vite dev server, so the
 * same `VITE_FEATURE_EXTRAS_ENABLED` value that gates the app also decides
 * whether specs for the frozen extras (Map, Clips feed, Verified Pro) run.
 * Default (unset) = the production feature freeze: those specs skip, and the
 * rest of the suite exercises the core Challenge loop exactly as shipped.
 *
 *   VITE_FEATURE_EXTRAS_ENABLED=true npm run test:e2e   → run everything
 */
export const EXTRAS_ENABLED = process.env.VITE_FEATURE_EXTRAS_ENABLED === "true";

export const EXTRAS_SKIP_REASON =
  "Feature freeze: Map / Clips feed / Verified Pro are hidden unless VITE_FEATURE_EXTRAS_ENABLED=true";
