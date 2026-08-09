/**
 * Lazy PostHog wrapper.
 *
 * posthog-js is only loaded (via dynamic import) when {@link initPosthog} is
 * called, which only happens when `VITE_POSTHOG_KEY` is set at build time.
 * All exported helpers are safe no-ops until then, so callers never need to
 * guard against an uninitialised SDK — the analytics service can fan out
 * events unconditionally and they just disappear until the key lands.
 *
 * This mirrors the pattern in {@link ./sentry.ts} so the two providers
 * behave identically at startup.
 */
import type { PostHog, PostHogConfig } from "posthog-js";
import { isAnalyticsAllowed, subscribeConsent } from "./consent";

let sdk: PostHog | null = null;

export interface PosthogInitConfig {
  apiKey: string;
  /** Optional host — defaults to the US cloud. */
  host?: string;
  /** Release identifier for cohort analysis + debugging. */
  release?: string;
  /** Additional PostHog config overrides. */
  extra?: Partial<PostHogConfig>;
}

/**
 * Load and initialise PostHog. Safe to call multiple times — subsequent calls
 * are ignored. Dynamic import keeps the ~90KB SDK out of the initial bundle
 * when the key is absent (preview deployments, local dev without analytics).
 */
export async function initPosthog(config: PosthogInitConfig): Promise<void> {
  if (sdk) return;
  const mod = await import("posthog-js");
  const instance = mod.default;
  instance.init(config.apiKey, {
    api_host: config.host ?? "https://us.i.posthog.com",
    // We already ask explicit consent via ConsentBanner; PostHog autocapture
    // is off by default so we only record events we define ourselves.
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    // Respect Do-Not-Track and the ConsentBanner default.
    respect_dnt: true,
    // Session replay is opt-in per event; leave off at boot.
    disable_session_recording: true,
    // Persist identity in localStorage only; no third-party cookies.
    persistence: "localStorage",
    ...(config.release ? { bootstrap: { featureFlags: {} } } : {}),
    ...config.extra,
  });
  if (config.release) {
    instance.register({ app_version: config.release });
  }
  sdk = instance;
}

/**
 * Start PostHog once — and only once — the visitor has accepted the consent
 * banner. Returns an unsubscribe function so a caller (or a test) can drop the
 * pending listener; it is a no-op if consent was already granted.
 *
 * WHY GATING EVENTS WAS NOT ENOUGH: `trackEvent` and `posthogIdentify` already
 * refuse to emit without consent, which made it look as though nothing reached
 * PostHog beforehand. It did. `posthog.init()` immediately mints a
 * `distinct_id`, persists it to `localStorage`, and contacts PostHog — a
 * remote-config fetch, then `POST /flags/` carrying that id and the timezone
 * (and implicitly the IP and User-Agent), repeating every ~5 minutes. None of
 * that is event capture, so none of it is suppressed by `autocapture: false`,
 * `capture_pageview: false`, or `respect_dnt`; those govern events only. So a
 * pseudonymous identifier was created and phoned home for every visitor before
 * they answered the banner — and it survived them explicitly declining.
 *
 * The privacy policy states PostHog "only runs after you accept the consent
 * banner" (`PrivacyPolicy.tsx` §5 and §8). Deferring `init` is what makes that
 * sentence true of PostHog itself, not merely of the events we send it.
 *
 * Deferring rather than passing `opt_out_capturing_by_default` is deliberate:
 * that flag suppresses capture but still initialises, so the identifier would
 * still be minted and persisted.
 */
export function initPosthogOnConsent(config: PosthogInitConfig, onError: (err: unknown) => void): () => void {
  const start = (): void => {
    // Fire-and-forget: callers never await analytics bootstrap.
    void initPosthog(config).catch(onError);
  };

  if (isAnalyticsAllowed()) {
    // Returning visitor who already accepted — no banner will be shown, so
    // there is nothing to wait for.
    start();
    return () => {};
  }

  // Wait for a decision. `subscribeConsent` also fires on the cross-tab
  // `storage` event, so accepting in one tab starts analytics in the others
  // without a reload. A decline leaves the subscription in place so the user
  // can still change their mind later in the same session; `initPosthog` is
  // idempotent, so a duplicate notification cannot double-initialise.
  const unsubscribe = subscribeConsent(() => {
    if (!isAnalyticsAllowed()) return;
    unsubscribe();
    start();
  });
  return unsubscribe;
}

/** Record an analytics event. No-op until initPosthog resolves. */
export function captureEvent(name: string, properties?: Record<string, unknown>): void {
  sdk?.capture(name, properties);
}

/**
 * Associate subsequent events with a specific user. Call on sign-in; call
 * {@link resetIdentity} on sign-out so the next user doesn't inherit events.
 */
export function identify(distinctId: string, properties?: Record<string, unknown>): void {
  sdk?.identify(distinctId, properties);
}

/**
 * Clear the identified user. Must be called on sign-out so an anonymous
 * session doesn't get merged with the previous user's distinct_id.
 */
export function resetIdentity(): void {
  sdk?.reset();
}
