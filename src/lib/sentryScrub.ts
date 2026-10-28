/**
 * The Sentry `beforeSend` / `beforeBreadcrumb` hooks wired up in src/main.tsx.
 *
 * They live here (not inline in main.tsx, which coverage excludes) so the
 * exact functions that ship are unit tested.
 *
 * Breadcrumbs are scrubbed when they are recorded, not just when an event is
 * sent. Sentry's console integration records every console line as a crumb,
 * and native errors put Firebase Storage URLs (with their download token) in
 * plain text, e.g. "Error downloading file: https://...?alt=media&token=...".
 */
import type * as SentryTypes from "@sentry/react";
import { redactPII, stripUrlQuery } from "../utils/pii";

type SentryInitConfig = NonNullable<Parameters<typeof SentryTypes.init>[0]>;
type BeforeSend = NonNullable<SentryInitConfig["beforeSend"]>;
type SentryErrorEvent = Parameters<BeforeSend>[0];
type Breadcrumb = Parameters<NonNullable<SentryInitConfig["beforeBreadcrumb"]>>[0];

// Param names we must never ship to Sentry. Case-insensitive and anchored
// only to a leading boundary (?, &, ; or start) so it won't eat substrings
// of unrelated keys.
const PII_PARAM_RE =
  /([?&;]|^)(email|token|api[_-]?key|access[_-]?token|id[_-]?token|auth|authorization|password|phone|otp|verification[_-]?code)=([^&#]*)/gi;

/** Redact the values of known PII params, keeping the rest of the URL. */
export function scrubUrl(url: string): string {
  return url.replace(PII_PARAM_RE, (_match, sep: string, key: string) => `${sep}${key}=[REDACTED]`);
}

// src/services/logger.ts prints "[WARN]", event, data in dev and one
// '{"level":"warn",...}' JSON string in production.
const LOGGER_DEV_LABEL_RE = /^\[(?:DEBUG|INFO|WARN|ERROR)\]$/;
const LOGGER_PROD_PREFIX = '{"level":"';

/**
 * True for a console crumb printed by our own logger. The logger already
 * records its own redacted "app" crumb for the same event; the console copy
 * holds the raw data (in production as one JSON string, where key-based
 * redaction can't reach the uid and email values), so it is dropped.
 */
function isLoggerConsoleCrumb(crumb: Breadcrumb): boolean {
  if (crumb.category !== "console") return false;
  const args: unknown = crumb.data?.arguments;
  const first: unknown = Array.isArray(args) ? args[0] : undefined;
  return typeof first === "string" && (LOGGER_DEV_LABEL_RE.test(first) || first.startsWith(LOGGER_PROD_PREFIX));
}

function scrubCrumbFields(crumb: Breadcrumb): void {
  if (typeof crumb.message === "string") crumb.message = stripUrlQuery(crumb.message);
  if (crumb.data) {
    // Every string, at any depth (console data.arguments included), loses its
    // URL queries, and uid/email/username keys are redacted.
    const data = redactPII(crumb.data)!;
    // fetch/xhr urls can be relative and navigation from/to are app paths,
    // which stripUrlQuery leaves alone, so redact their PII params by name.
    for (const key of ["url", "from", "to"] as const) {
      const value = data[key];
      if (typeof value === "string") data[key] = scrubUrl(value);
    }
    crumb.data = data;
  }
}

/** Sentry `beforeBreadcrumb`: drop the logger's raw console copies, scrub the rest. */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (isLoggerConsoleCrumb(crumb)) return null;
  scrubCrumbFields(crumb);
  return crumb;
}

/** Sentry `beforeSend`: strip PII and URL tokens from everything an event carries. */
export function scrubEvent(event: SentryErrorEvent): SentryErrorEvent {
  if (event.request?.url) {
    event.request.url = scrubUrl(event.request.url);
  }
  // Drop request headers/cookies wholesale. They can carry auth tokens,
  // session cookies, and the user's IP via forwarding headers. We never need
  // them for triage, so strip rather than scrub.
  if (event.request) {
    delete event.request.headers;
    delete event.request.cookies;
  }
  // sendDefaultPii=false already keeps the SDK from auto-populating these,
  // but setUser() (src/lib/sentry.ts) can still attach them.
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
  }
  // An error's message is free text and can embed a tokenised URL.
  if (typeof event.message === "string") event.message = stripUrlQuery(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value === "string") exception.value = stripUrlQuery(exception.value);
  }
  if (event.extra) event.extra = redactPII(event.extra);
  // Crumbs were scrubbed by scrubBreadcrumb when recorded; this second pass
  // also covers any attached another way (e.g. a scope's crumbs).
  for (const crumb of event.breadcrumbs ?? []) scrubCrumbFields(crumb);
  return event;
}
