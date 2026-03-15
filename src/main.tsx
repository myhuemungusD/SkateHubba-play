import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initSentry, captureException } from "./lib/sentry";
import App from "./App";
import "./index.css";

// Initialise Sentry only when a DSN is provided (set VITE_SENTRY_DSN in
// Vercel → Project Settings → Environment Variables).
// initSentry() dynamically imports @sentry/react so the SDK is never
// bundled or fetched when no DSN is configured.
if (import.meta.env.VITE_SENTRY_DSN) {
  initSentry({
    dsn: String(import.meta.env.VITE_SENTRY_DSN),
    environment: import.meta.env.MODE,
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

// Catch unhandled promise rejections that escape try/catch blocks and report
// them to Sentry so they are never silently lost in production.
window.addEventListener("unhandledrejection", (event) => {
  captureException(event.reason, { extra: { type: "unhandledrejection" } });
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element in index.html");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
