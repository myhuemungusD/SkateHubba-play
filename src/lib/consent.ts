/**
 * Analytics consent storage + subscription.
 *
 * Single source of truth for the `sh_analytics_consent` localStorage key.
 * `trackEvent` and the Vercel Analytics/SpeedInsights mounts both read from
 * this module so the app only emits telemetry after the user opts in via
 * {@link ConsentBanner}. Default (no value stored) and `"declined"` both
 * resolve to "not allowed" — fail-closed so we never leak events before a
 * user has made a choice.
 *
 * A tiny pub/sub is exposed so React components can reactively gate mounts
 * on consent changes without polling. The banner calls {@link writeConsent}
 * which fans out to every subscriber plus cross-tab via `storage` events.
 */
export const CONSENT_KEY = "sh_analytics_consent";

export type ConsentValue = "accepted" | "declined";

/** Read consent from localStorage, treating any throw (Safari private mode,
 *  disabled storage) as "unknown" so the caller decides the default. */
export function readConsent(): ConsentValue | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "accepted" || v === "declined" ? v : null;
  } catch {
    return null;
  }
}

/** Persist consent and notify every subscriber in the current tab.
 *  Cross-tab listeners get the update via the native `storage` event. */
export function writeConsent(value: ConsentValue): void {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Best-effort — in private mode we can't persist, but subscribers in
    // this tab still get the fan-out so the UI updates for the session.
  }
  for (const listener of listeners) listener();
}

/** Fail-closed gate used by `trackEvent` and the `<Analytics />` mount.
 *  Only `"accepted"` unlocks telemetry; `null` and `"declined"` do not. */
export function isAnalyticsAllowed(): boolean {
  return readConsent() === "accepted";
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to consent changes. Returns an unsubscribe function. */
export function subscribeConsent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Cross-tab sync: when another tab writes consent, notify local subscribers
// so the Analytics mount and any hooks re-evaluate.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === CONSENT_KEY) {
      for (const listener of listeners) listener();
    }
  });
}
