/**
 * Lightweight analytics wrapper.
 *
 * Centralises event tracking so swapping or adding providers is a one-file
 * change. Events fan out to:
 *   1. Vercel Analytics — via `window.va`, injected by `<Analytics />` in
 *      main.tsx. Page views, lightweight custom events, zero cost on top of
 *      the existing Vercel platform.
 *   2. PostHog — via the lazy wrapper in `src/lib/posthog.ts`. Funnel
 *      analysis, cohorts, retention. Only active when `VITE_POSTHOG_KEY`
 *      is set at build time; otherwise the call is a no-op.
 *
 * Both destinations receive the same event name + properties. Providers
 * stay in sync because helpers below are the only surface components call.
 */
import { captureEvent as posthogCapture } from "../lib/posthog";
import { isAnalyticsAllowed } from "../lib/consent";

type EventValue = string | number | boolean | null | undefined;
type EventProperties = Record<string, EventValue>;

/** Vercel Analytics injects `window.va` at runtime. */
interface WindowWithVa {
  va?: (command: string, payload: Record<string, unknown>) => void;
}

function sendToVercel(name: string, properties?: EventProperties): void {
  try {
    const w = window as unknown as WindowWithVa;
    if (typeof w.va === "function") {
      w.va("event", { name, ...properties });
    }
  } catch {
    // Analytics should never break the app.
  }
}

function sendToPosthog(name: string, properties?: EventProperties): void {
  try {
    posthogCapture(name, properties);
  } catch {
    // Analytics should never break the app.
  }
}

export function trackEvent(name: string, properties?: EventProperties): void {
  // Hard gate — no event leaves the client until the user has explicitly
  // accepted the ConsentBanner. `isAnalyticsAllowed` is fail-closed: a missing
  // or "declined" value both return false.
  if (!isAnalyticsAllowed()) return;
  sendToVercel(name, properties);
  sendToPosthog(name, properties);
}

// Pre-defined event helpers for type safety. Keep event names stable —
// renaming breaks historical funnels in PostHog and makes dashboards lie.
export const analytics = {
  gameCreated: (gameId: string) => trackEvent("game_created", { gameId }),
  trickSet: (gameId: string, trickName: string) => trackEvent("trick_set", { gameId, trickName }),
  matchSubmitted: (gameId: string, landed: boolean) => trackEvent("match_submitted", { gameId, landed }),
  gameCompleted: (gameId: string, won: boolean) => trackEvent("game_completed", { gameId, won }),
  videoUploaded: (durationMs: number, sizeBytes: number) => trackEvent("video_uploaded", { durationMs, sizeBytes }),
  signUp: (method: string) => trackEvent("sign_up", { method }),
  signIn: (method: string) => trackEvent("sign_in", { method }),
  // ── Map funnel ────────────────────────────────────────────────────────
  /** Top of funnel — fires once per MapPage mount. */
  mapViewed: () => trackEvent("map_viewed"),
  /** Fired when a user taps a marker and the SpotPreviewCard opens. */
  spotPreviewed: (spotId: string) => trackEvent("spot_previewed", { spotId }),
  /** Fired when ChallengeScreen mounts with a valid ?spot= URL param. */
  challengeFromSpot: (spotId: string) => trackEvent("challenge_from_spot", { spotId }),
} as const;
