/**
 * Feature-flag service.
 *
 * Thin wrapper around PostHog's `isFeatureEnabled` so the rest of the app
 * never reaches into the SDK directly. Every other PR in the profile/stats
 * rollout depends on this — flags gate the staged rollouts and the kill
 * switches.
 *
 * Three layered fallbacks make the helper safe to call from anywhere:
 *   1. Server-side / pre-hydration → return the supplied default. PostHog
 *      is browser-only.
 *   2. Consent denied or unknown   → return the default. Reading flags
 *      requires fetching them from PostHog, which counts as analytics.
 *   3. PostHog not initialised yet → return the default. The SDK loads
 *      lazily; flags arrive a few hundred ms after `initPosthog`.
 *
 * Telemetry: we emit `feature_flag_evaluated` on a 1% sample so the
 * dashboard has signal on which flags are actually being read without
 * burying PostHog ingest in noise.
 *
 * The React hook variant (`useFeatureFlag`) lives in
 * `src/hooks/useFeatureFlag.ts` — per CLAUDE.md, hooks belong under
 * `src/hooks/`. The hook composes the `subscribeFeatureFlags` /
 * `getFeatureFlagSnapshot` primitives exported below.
 */
import { getPostHogClient } from "../lib/posthog";
import { isAnalyticsAllowed, subscribeConsent } from "../lib/consent";
import { analytics } from "./analytics";

/**
 * 1% sampling rate for `feature_flag_evaluated`. Flags are read on every
 * render of every gated surface — without sampling we'd swamp PostHog.
 */
const FLAG_TELEMETRY_SAMPLE_RATE = 0.01;

function emitFlagTelemetry(flag: string, value: boolean, defaultUsed: boolean): void {
  if (Math.random() >= FLAG_TELEMETRY_SAMPLE_RATE) return;
  analytics.featureFlagEvaluated(flag, value, defaultUsed);
}

/**
 * Synchronous flag evaluation. Returns `defaultValue` whenever PostHog is
 * unavailable, consent has not been granted, or the flag is unknown.
 *
 * Default is `false` — every gated feature in the rollout plan is opt-in.
 */
export function isFeatureEnabled(flag: string, defaultValue = false): boolean {
  // SSR / pre-hydration guard. jsdom always defines `window`, so this
  // branch is unreachable from the unit tests; coverage is intentionally
  // ignored to avoid forcing a bespoke node-environment test file.
  /* v8 ignore next 4 */
  if (typeof window === "undefined") {
    emitFlagTelemetry(flag, defaultValue, true);
    return defaultValue;
  }
  if (!isAnalyticsAllowed()) {
    emitFlagTelemetry(flag, defaultValue, true);
    return defaultValue;
  }
  const ph = getPostHogClient();
  if (!ph) {
    emitFlagTelemetry(flag, defaultValue, true);
    return defaultValue;
  }
  const raw = ph.isFeatureEnabled(flag);
  if (raw === undefined) {
    emitFlagTelemetry(flag, defaultValue, true);
    return defaultValue;
  }
  const value = !!raw;
  emitFlagTelemetry(flag, value, false);
  return value;
}

/**
 * Subscribe to PostHog flag-flush and consent-flip events. The returned
 * unsubscribe callback tears down both inner subscriptions. Exposed for
 * the `useFeatureFlag` hook in `src/hooks/` so it can drive
 * `useSyncExternalStore` without owning Firebase/PostHog plumbing.
 */
export function subscribeFeatureFlags(notify: () => void): () => void {
  const ph = getPostHogClient();
  const phUnsub = ph?.onFeatureFlags(notify);
  const consentUnsub = subscribeConsent(notify);
  return () => {
    phUnsub?.();
    consentUnsub();
  };
}

/**
 * Snapshot accessor for {@link useFeatureFlag}. Identical to
 * {@link isFeatureEnabled} — re-exported under the snapshot name to make
 * the hook's `useSyncExternalStore` wiring read top-to-bottom.
 */
export function getFeatureFlagSnapshot(flag: string, defaultValue = false): boolean {
  return isFeatureEnabled(flag, defaultValue);
}
