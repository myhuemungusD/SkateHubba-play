/**
 * Server-side error reporting for the Vercel functions under `api/`.
 *
 * The browser has had Sentry for a long time (src/lib/sentry.ts); the server
 * had only `console.warn` lines, so a failed account erasure or a cron run
 * that errored on every game was visible only to someone already reading the
 * Vercel logs. This module sends those failures to the same Sentry org.
 *
 * Contract — every one of these is pinned by api-sentry.test.ts:
 *
 *   • Inert without a DSN. `SENTRY_DSN` unset (local dev, CI, forks) means the
 *     SDK is never even imported and every export is a cheap no-op. Nothing
 *     here can make a handler fail: init, capture and flush all swallow their
 *     own errors.
 *   • No PII leaves the function. `sendDefaultPii: false`, no request or user
 *     context is ever attached, breadcrumbs are disabled, and `beforeSend`
 *     runs every string in the event through `scrubString` (emails, bearer
 *     tokens, JWTs, private keys) and drops values under sensitive keys
 *     (authorization, cookie, token, secret, password, email, …). Firebase
 *     uids are pseudonymous and are kept, matching the structured logs.
 *   • Flushed before the response. A Vercel function can be frozen as soon as
 *     its response ends, so callers `await flushServerErrors()` BEFORE writing
 *     an error response; `withSentry` flushes on the unhandled-throw path.
 *   • Bounded. At most MAX_EVENTS_PER_INVOCATION events per request, so a
 *     cron run in which every game fails the same way costs a handful of
 *     events, not hundreds (the structured logs still carry every failure).
 *   • Lightweight. Default integrations (OpenTelemetry auto-instrumentation,
 *     global process handlers, HTTP breadcrumbs) are off: they add cold-start
 *     time and could capture request data, and the platform owns the process.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type * as SentryNode from "@sentry/node";

type SentrySdk = typeof SentryNode;
type SentryEvent = SentryNode.ErrorEvent;

export const MAX_EVENTS_PER_INVOCATION = 10;
const FLUSH_TIMEOUT_MS = 2000;

let sdk: SentrySdk | null = null;
let initPromise: Promise<SentrySdk | null> | null = null;

/** Per-request event budget. Falls back to a module counter outside a request. */
const invocation = new AsyncLocalStorage<{ sent: number }>();
const fallbackBudget = { sent: 0 };

// ── Scrubbing ──────────────────────────────────────────────────────────────

const SENSITIVE_KEY =
  /authorization|cookie|token|secret|password|passwd|api[-_]?key|private[-_]?key|credential|email|phone|ip_address/i;

const STRING_SCRUBBERS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[private-key]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [token]"],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, "[jwt]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
];

export function scrubString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of STRING_SCRUBBERS) out = out.replace(pattern, replacement);
  return out;
}

/** Deep-scrub any JSON-ish value. Depth-limited so a cyclic object can't hang. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object" || depth > 12) return value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[Filtered]" : scrubValue(v, depth + 1);
  }
  return out;
}

/** `beforeSend`: strip identity/request context, then scrub everything left. */
export function scrubEvent(event: SentryEvent): SentryEvent {
  const copy = { ...event };
  delete copy.user;
  delete copy.request;
  delete copy.breadcrumbs;
  delete copy.server_name;
  return scrubValue(copy) as SentryEvent;
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

/** Load and init the SDK once per instance; null (and never throws) without a DSN. */
export function ensureSentry(): Promise<SentrySdk | null> {
  if (initPromise) return initPromise;
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return Promise.resolve(null);
  initPromise = import("@sentry/node")
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
        release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
        sendDefaultPii: false,
        defaultIntegrations: false,
        integrations: [Sentry.linkedErrorsIntegration()],
        skipOpenTelemetrySetup: true,
        maxBreadcrumbs: 0,
        beforeBreadcrumb: () => null,
        beforeSend: (event) => scrubEvent(event),
      });
      sdk = Sentry;
      return Sentry;
    })
    .catch((err: unknown) => {
      console.warn(
        JSON.stringify({ event: "sentry_init_failed", message: err instanceof Error ? err.name : "unknown" }),
      );
      return null;
    });
  return initPromise;
}

export interface CaptureOptions {
  /** Default "error". Use "warning" for per-item failures a later run retries. */
  level?: "error" | "warning";
  /**
   * Replace the error with a message-free one. Use when the message may embed
   * secret material — e.g. a JSON.parse failure on the service-account env
   * var quotes a snippet of it (V8 includes the input in the message AND the
   * first stack line), which no regex can reliably recognise.
   */
  redactMessage?: boolean;
}

/**
 * Report a caught failure. `event` is the same name the structured log line
 * uses (e.g. `account_delete_erasure_failed`) so Sentry and Vercel logs join
 * on it. `fields` should hold only ids/counters; it is scrubbed regardless.
 */
export function captureServerError(
  event: string,
  err: unknown,
  fields: Record<string, unknown> = {},
  options: CaptureOptions = {},
): void {
  if (!sdk) return;
  const budget = invocation.getStore() ?? fallbackBudget;
  if (budget.sent >= MAX_EVENTS_PER_INVOCATION) return;
  budget.sent += 1;
  try {
    const name = err instanceof Error ? err.name : typeof err;
    const reported = options.redactMessage
      ? new Error(`${event} (${name}; message redacted)`)
      : err instanceof Error
        ? err
        : new Error(`${event}: ${String(err)}`);
    sdk.captureException(reported, {
      level: options.level ?? "error",
      tags: { event },
      extra: scrubValue(fields) as Record<string, unknown>,
      fingerprint: ["{{ default }}", event],
    });
  } catch {
    // Reporting must never be the thing that breaks a handler.
  }
}

/** Wait (bounded) for queued events to send. Call BEFORE ending the response. */
export async function flushServerErrors(timeoutMs = FLUSH_TIMEOUT_MS): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.flush(timeoutMs);
  } catch {
    // A slow or unreachable Sentry must not fail the request.
  }
}

/**
 * Wrap a Vercel handler: initialise Sentry (when configured), give the request
 * its own event budget, and report + flush anything the handler throws before
 * rethrowing it to the platform (whose 500 behaviour is therefore unchanged).
 */
export function withSentry<Req, Res>(
  name: string,
  handler: (req: Req, res: Res) => Promise<void>,
): (req: Req, res: Res) => Promise<void> {
  return async (req, res) => {
    await ensureSentry();
    return invocation.run({ sent: 0 }, async () => {
      try {
        await handler(req, res);
      } catch (err) {
        captureServerError(`${name}_unhandled`, err, { handler: name });
        await flushServerErrors();
        throw err;
      }
    });
  };
}

/** Test-only: forget the initialised SDK so each test controls the env. */
export function __resetSentryForTests(): void {
  sdk = null;
  initPromise = null;
  fallbackBudget.sent = 0;
}
