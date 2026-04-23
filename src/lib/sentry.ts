/**
 * Lazy Sentry wrapper.
 *
 * On web the SDK is dynamically imported from `@sentry/react`. On
 * Capacitor native builds (iOS/Android) we swap in `@sentry/capacitor`,
 * which wraps `@sentry/react` and additionally forwards unhandled Swift /
 * Obj-C / Kotlin / Java crashes from the host shell. In both cases the
 * call-site API (initSentry, captureException, captureMessage,
 * addBreadcrumb, setUser) is identical, so nothing outside this file
 * needs to branch on platform.
 *
 * The SDK itself is only fetched when initSentry() is called — which
 * only happens when VITE_SENTRY_DSN is set (see src/main.tsx). All
 * exported helpers are safe no-ops until then, so callers never need
 * to guard against an uninitialised SDK.
 *
 * Native plugin note: `@sentry/capacitor` ships an iOS CocoaPods spec
 * and an Android Gradle module which land in the native project the
 * first time `npx cap sync` runs. See `ios/README.md` and
 * `android/app/README.md` for the one-time platform setup.
 */
import type * as SentryTypes from "@sentry/react";
import { Capacitor } from "@capacitor/core";

type SentryInitConfig = Parameters<typeof SentryTypes.init>[0];
type AddBreadcrumbArg = Parameters<typeof SentryTypes.addBreadcrumb>[0];
type CaptureExceptionArg = Parameters<typeof SentryTypes.captureException>[1];
type SentryUser = Parameters<typeof SentryTypes.setUser>[0];

// Minimum shape we use from whichever SDK variant is active. Both
// `@sentry/react` and `@sentry/capacitor` re-export these symbols with
// identical call signatures (capacitor re-exports from @sentry/core),
// so a single structural type covers both.
type SentryLike = {
  captureException: (err: unknown, ctx?: CaptureExceptionArg) => string;
  captureMessage: (msg: string, level?: SentryTypes.SeverityLevel) => string;
  addBreadcrumb: (crumb: AddBreadcrumbArg) => void;
  setUser: (user: SentryUser) => void;
};

let sdk: SentryLike | null = null;

export async function initSentry(config: SentryInitConfig): Promise<void> {
  // Load @sentry/react in all cases — on native we still need its init
  // function to hand to @sentry/capacitor as the "sibling" web SDK.
  const SentryReact = await import("@sentry/react");

  if (Capacitor.isNativePlatform()) {
    // @sentry/capacitor v3 pins @sentry/react@10.43.0 as a peer. If we
    // ever bump @sentry/react we must bump @sentry/capacitor in lockstep
    // — see scripts/check-siblings.js inside the package for the guard.
    const SentryCapacitor = await import("@sentry/capacitor");
    SentryCapacitor.init(config, SentryReact.init);
    sdk = SentryCapacitor as unknown as SentryLike;
  } else {
    SentryReact.init(config);
    sdk = SentryReact as unknown as SentryLike;
  }
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
