import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import "./index.css";

// Initialise Sentry only when a DSN is provided (set VITE_SENTRY_DSN in
// Vercel → Project Settings → Environment Variables).
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN as string,
    environment: import.meta.env.MODE,
    // Capture 100% of transactions in development; 10% in production to
    // stay within the free quota. Adjust as traffic grows.
    tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
    // Strip PII from breadcrumbs / event data.
    beforeSend(event) {
      // Remove any user email accidentally captured in request URLs.
      if (event.request?.url) {
        event.request.url = event.request.url.replace(
          /([?&]email=)[^&]*/gi,
          "$1[REDACTED]"
        );
      }
      return event;
    },
  });
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element in index.html");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
