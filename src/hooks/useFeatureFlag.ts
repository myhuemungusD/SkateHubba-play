/**
 * React hook for PostHog feature flags. Lives under `src/hooks/` per
 * CLAUDE.md — service modules host the synchronous {@link isFeatureEnabled}
 * primitive plus the {@link subscribeFeatureFlags} / {@link getFeatureFlagSnapshot}
 * accessors this hook composes via {@link useSyncExternalStore}.
 *
 * Re-renders fire when PostHog flushes new flag values (`onFeatureFlags`)
 * or when the user toggles analytics consent — flipping consent from
 * declined → accepted unblocks flag reads, and any gated surface should
 * pick that up without a full page reload.
 *
 * `useSyncExternalStore` is the same primitive `useAnalyticsConsent` uses,
 * so the eslint-react-hooks plugin's setState-in-effect rule never fires
 * and tearing is impossible.
 */
import { useSyncExternalStore } from "react";
import { getFeatureFlagSnapshot, subscribeFeatureFlags } from "../services/featureFlags";

export function useFeatureFlag(flag: string, defaultValue = false): boolean {
  const subscribe = (notify: () => void): (() => void) => subscribeFeatureFlags(notify);
  const getSnapshot = (): boolean => getFeatureFlagSnapshot(flag, defaultValue);
  // Server snapshot mirrors the synchronous default — PostHog is browser-
  // only, so server-side renders should never differ from the fallback.
  // Vitest runs in jsdom, never invoking the server-snapshot path; the
  // ignore avoids forcing a bespoke SSR-environment test for one line.
  /* v8 ignore next */
  const getServerSnapshot = (): boolean => defaultValue;
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
