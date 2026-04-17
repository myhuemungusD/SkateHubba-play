import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { initSentry, captureException } from "./lib/sentry";
import { initPosthog } from "./lib/posthog";
import App from "./App";
import "./index.css";

// Prefer an explicit release tag (set by the Release workflow to the
// tag_name, e.g. "v1.2.0") and fall back to the VERCEL_GIT_COMMIT_SHA for
// Preview builds. This single identifier lets Sentry dedupe stack traces
// by release and lets PostHog cohort by app version.
const APP_RELEASE =
  (import.meta.env.VITE_APP_VERSION as string | undefined) ||
  (import.meta.env.VITE_GIT_SHA as string | undefined) ||
  undefined;

// Initialise Sentry only when a DSN is provided (set VITE_SENTRY_DSN in
// Vercel → Project Settings → Environment Variables).
// initSentry() dynamically imports @sentry/react so the SDK is never
// bundled or fetched when no DSN is configured.
if (import.meta.env.VITE_SENTRY_DSN) {
  initSentry({
    dsn: String(import.meta.env.VITE_SENTRY_DSN),
    environment: import.meta.env.MODE,
    // Tag each event with the deploy's release so Sentry can track regressions
    // across versions. Source maps uploaded in release.yml key off this string.
    release: APP_RELEASE,
    // Capture 100% of transactions in development; 10% in production to
    // stay within the free quota. Adjust as traffic grows.
    tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
    // Strip PII from breadcrumbs / event data.
    beforeSend(event) {
      // Strip email query params from URLs wherever they appear.
      // Using a global replace (not anchored to ?/&) catches edge cases like
      // email= at the start of a query string or after a hash.
      if (event.request?.url) {
        event.request.url = event.request.url.replace(/email=[^&]*/gi, "email=[REDACTED]");
      }
      return event;
    },
  });
}

// Initialise PostHog only when a project API key is provided. Safe to fire-
// and-forget: the wrapper no-ops until the dynamic import resolves, and all
// events queued against it during that window are dropped rather than
// bursting a boot-time network request.
if (import.meta.env.VITE_POSTHOG_KEY) {
  void initPosthog({
    apiKey: String(import.meta.env.VITE_POSTHOG_KEY),
    host: import.meta.env.VITE_POSTHOG_HOST ? String(import.meta.env.VITE_POSTHOG_HOST) : undefined,
    release: APP_RELEASE,
  }).catch((err) => {
    // PostHog init failures (network, quota, bad key) must never break the
    // app — Sentry gets the breadcrumb, the rest of the app carries on.
    captureException(err, { extra: { context: "initPosthog" } });
  });
}

// Catch unhandled promise rejections that escape try/catch blocks and report
// them to Sentry so they are never silently lost in production.
window.addEventListener("unhandledrejection", (event) => {
  captureException(event.reason, { extra: { type: "unhandledrejection" } });
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element in index.html");

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
