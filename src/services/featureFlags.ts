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
 */
import { useSyncExternalStore } from "react";
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
 * React hook variant. Re-renders when PostHog flushes new flag values
 * (`onFeatureFlags`) or when the user updates analytics consent. The
 * latter matters because flipping consent from declined → accepted
 * unblocks flag reads, and the gated surface should pick that up
 * without a full page reload.
 *
 * Implemented via `useSyncExternalStore` — the same primitive
 * `useAnalyticsConsent` uses — so the eslint-react-hooks plugin's
 * setState-in-effect rule never fires and tearing is impossible.
 */
export function useFeatureFlag(flag: string, defaultValue = false): boolean {
  const subscribe = (notify: () => void): (() => void) => {
    const ph = getPostHogClient();
    const phUnsub = ph?.onFeatureFlags(notify);
    const consentUnsub = subscribeConsent(notify);
    return () => {
      phUnsub?.();
      consentUnsub();
    };
  };
  const getSnapshot = (): boolean => isFeatureEnabled(flag, defaultValue);
  // Server snapshot mirrors the synchronous default — PostHog is browser-
  // only, so server-side renders should never differ from the fallback.
  // Vitest runs in jsdom, never invoking the server-snapshot path; the
  // ignore avoids forcing a bespoke SSR-environment test for one line.
  /* v8 ignore next */
  const getServerSnapshot = (): boolean => defaultValue;
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
