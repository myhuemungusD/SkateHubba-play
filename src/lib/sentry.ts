/**
 * Lazy Sentry wrapper.
 *
 * @sentry/react is only loaded (via dynamic import) when initSentry() is
 * called, which only happens when VITE_SENTRY_DSN is set.  All exported
 * helpers are safe no-ops until then, so callers never need to guard against
 * an uninitialised SDK.
 */
import type * as SentryTypes from "@sentry/react";

type SentryInitConfig = Parameters<typeof SentryTypes.init>[0];
type AddBreadcrumbArg = Parameters<typeof SentryTypes.addBreadcrumb>[0];
type CaptureExceptionArg = Parameters<typeof SentryTypes.captureException>[1];
type SentryUser = Parameters<typeof SentryTypes.setUser>[0];

let sdk: typeof SentryTypes | null = null;

export async function initSentry(config: SentryInitConfig): Promise<void> {
  sdk = await import("@sentry/react");
  sdk.init(config);
}

export function captureException(err: unknown, ctx?: CaptureExceptionArg): void {
  sdk?.captureException(err, ctx);
}

export function captureMessage(msg: string, level?: SentryTypes.SeverityLevel): void {
  sdk?.captureMessage(msg, level);
}

export function addBreadcrumb(crumb: AddBreadcrumbArg): void {
  sdk?.addBreadcrumb(crumb);
}

export function setUser(user: SentryUser): void {
  sdk?.setUser(user);
}

export function setTag(key: string, value: string): void {
  sdk?.setTag(key, value);
}
