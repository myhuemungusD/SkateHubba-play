import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { initSentry, captureException, addBreadcrumb } from "./lib/sentry";
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

// Regex listing param names we must never ship to Sentry. Match is
// case-insensitive and anchored only to a leading boundary (?, &, or start)
// so it won't accidentally eat substrings of unrelated keys.
const PII_PARAM_RE =
  /([?&;]|^)(email|token|api[_-]?key|access[_-]?token|id[_-]?token|auth|authorization|password|phone|otp|verification[_-]?code)=([^&#]*)/gi;

function scrubUrl(url: string): string {
  return url.replace(PII_PARAM_RE, (_match, sep: string, key: string) => `${sep}${key}=[REDACTED]`);
}

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
    // Strip PII from breadcrumbs / event data. We scrub both the request URL
    // and any breadcrumb data.url since a reported event often carries
    // navigation history (fetch, history.pushState) picked up automatically
    // by the browser integrations — those are a more common PII leak than
    // the report URL itself.
    beforeSend(event) {
      if (event.request?.url) {
        event.request.url = scrubUrl(event.request.url);
      }
      if (event.breadcrumbs) {
        for (const crumb of event.breadcrumbs) {
          const url = crumb.data?.url;
          if (typeof url === "string") crumb.data!.url = scrubUrl(url);
        }
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

// Capacitor's SplashScreen plugin is configured with `launchAutoHide: false`
// (see capacitor.config.ts), so the native splash stays visible until we
// explicitly hide it. Dismiss it after the first React paint — via
// requestAnimationFrame — so users never see a white flash between splash
// and the mounted app. Dynamic import keeps the splash-screen plugin out
// of the web bundle; the import is only evaluated on native platforms.
if (Capacitor.isNativePlatform()) {
  requestAnimationFrame(async () => {
    try {
      const { SplashScreen } = await import("@capacitor/splash-screen");
      await SplashScreen.hide({ fadeOutDuration: 300 });
      addBreadcrumb({ category: "lifecycle", message: "splash_hidden" });
    } catch (err) {
      addBreadcrumb({
        category: "lifecycle",
        message: "splash_hide_failed",
        data: { error: String(err) },
      });
    }
  });
}
