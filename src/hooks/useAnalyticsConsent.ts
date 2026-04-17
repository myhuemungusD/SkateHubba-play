import { useSyncExternalStore } from "react";
import { isAnalyticsAllowed, subscribeConsent } from "../lib/consent";

/** @internal exported for testing */
export function getSnapshot(): boolean {
  return isAnalyticsAllowed();
}

/** @internal exported for testing. SSR fallback defaults to false so events
 *  never leak before hydration reads real consent from localStorage. */
export function getServerSnapshot(): boolean {
  return false;
}

/** Reactively tracks the user's analytics consent. Returns `true` only after
 *  the user has explicitly accepted via `ConsentBanner`. Flips live when the
 *  banner writes a new value, including from another tab. */
export function useAnalyticsConsent(): boolean {
  return useSyncExternalStore(subscribeConsent, getSnapshot, getServerSnapshot);
}
