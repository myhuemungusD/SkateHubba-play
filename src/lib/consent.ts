/**
 * Single source of truth for the `sh_analytics_consent` localStorage key.
 * `trackEvent` and the Vercel Analytics/SpeedInsights mounts both fail closed
 * on this: unknown or "declined" never emit telemetry. A tiny pub/sub lets
 * React gates react without polling, and a `storage` listener syncs tabs.
 */
export const CONSENT_KEY = "sh_analytics_consent";

export type ConsentValue = "accepted" | "declined";

export function readConsent(): ConsentValue | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "accepted" || v === "declined" ? v : null;
  } catch {
    // Safari private mode / disabled storage — caller decides the default.
    return null;
  }
}

export function writeConsent(value: ConsentValue): void {
  const prev = readConsent();
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Best-effort — private mode can't persist. We intentionally fall through
    // without notifying below: listeners would re-read the old value and the
    // "change" event would be a lie.
  }
  if (readConsent() !== prev) {
    for (const listener of listeners) listener();
  }
}

export function isAnalyticsAllowed(): boolean {
  return readConsent() === "accepted";
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeConsent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === CONSENT_KEY) {
      for (const listener of listeners) listener();
    }
  });
}
