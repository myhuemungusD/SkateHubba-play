/**
 * Browser init-script that pre-answers the cookie/analytics consent prompt.
 *
 * ConsentBanner renders `fixed bottom-0 left-0 right-0 z-50` until the user
 * answers it, and no spec ever did. Anything it covers is unclickable:
 * Playwright reported "…<div role='region' aria-label='Cookie and analytics
 * notice'> subtree intercepts pointer events" and retried until the action
 * timed out, which is what made every recording spec fail on the recorder's
 * own controls.
 *
 * Seeding the key the banner initialises from (synchronously, so it never
 * flickers) keeps it from mounting at all. "declined" rather than "accepted"
 * so the suite emits no telemetry — `trackEvent` and the Vercel Analytics /
 * SpeedInsights mounts all fail closed on this value.
 *
 * Must be injected with `page.addInitScript()` BEFORE the first navigation.
 */
export const CONSENT_ANSWERED_SCRIPT = `
(function () {
  'use strict';
  try {
    localStorage.setItem('sh_analytics_consent', 'declined');
  } catch {
    // Private-mode storage can throw; the banner then shows and the spec
    // that needs it dismissed will say so loudly rather than silently.
  }
})();
`;
