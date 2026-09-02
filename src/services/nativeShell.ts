/**
 * Capacitor native shell bridge — hardware back button, deep links, status bar.
 *
 * This is the ONLY file allowed to import `@capacitor/app` and
 * `@capacitor/status-bar` (services-layer rule from CLAUDE.md). The UI layer
 * consumes these helpers through `src/hooks/useNativeShell.ts`; it never
 * touches the plugins directly.
 *
 * Every plugin import is dynamic and gated on `Capacitor.isNativePlatform()`
 * so the native plugin code is never evaluated (or bundled into the initial
 * chunk) on the web — the same pattern used by the splash-screen hide in
 * `src/main.tsx` and by `src/lib/sentry.ts`.
 *
 * Native setup this file cannot do for you:
 *  - Android: declare the App Links intent-filter for https://skatehubba.com
 *    in AndroidManifest.xml and host /.well-known/assetlinks.json.
 *  - iOS: add the `applinks:skatehubba.com` Associated Domains entitlement
 *    and host /.well-known/apple-app-site-association.
 */

import { Capacitor } from "@capacitor/core";
import { logger } from "./logger";

/** Background behind the status bar — matches capacitor.config.ts. */
const STATUS_BAR_BACKGROUND = "#0A0A0A";

/** True when the app is running inside a Capacitor native shell. */
export function isNativeShell(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Set the status bar to light text on the app's near-black background.
 *
 * `Style.Dark` means "dark background, therefore light content" in the
 * plugin's vocabulary — the app is dark-only, so this is unconditional.
 * The background colour is Android-only; iOS derives it from the web view.
 * No-ops on web and swallows plugin failures — a status bar that didn't
 * restyle must never take the app down at startup.
 */
export async function initStatusBar(): Promise<void> {
  if (!isNativeShell()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    if (Capacitor.getPlatform() === "android") {
      await StatusBar.setBackgroundColor({ color: STATUS_BAR_BACKGROUND });
    }
  } catch (err) {
    logger.warn("status_bar_init_failed", { error: String(err) });
  }
}

/** A listener handle the caller can detach, mirroring the plugin's shape. */
interface RemovableHandle {
  remove: () => Promise<void>;
}

/**
 * Wrap the plugin's async `addListener` promise in a synchronous unsubscribe
 * function, so callers (React effects) can return it directly. Attach errors
 * are logged and collapse into a no-op unsubscribe.
 */
function toUnsubscribe(event: string, attach: Promise<RemovableHandle>): () => void {
  let removed = false;
  const handle = attach.catch((err: unknown) => {
    logger.warn("native_app_listener_failed", { event, error: String(err) });
    return null;
  });

  return () => {
    if (removed) return;
    removed = true;
    void handle.then((h) => h?.remove()).catch(() => {});
  };
}

/** Payload delivered to a hardware back-button subscriber. */
export interface BackButtonEvent {
  /** True when the web view has SPA history it can pop. */
  canGoBack: boolean;
}

/**
 * Subscribe to the Android hardware back button.
 *
 * Registering ANY listener disables Capacitor's default "go back, then
 * suspend" behaviour, so the subscriber owns the decision entirely — pop SPA
 * history or exit. Returns an unsubscribe function; safe (no-op) on web.
 */
export function subscribeToBackButton(cb: (event: BackButtonEvent) => void): () => void {
  if (!isNativeShell()) return () => {};
  return toUnsubscribe(
    "backButton",
    import("@capacitor/app").then(({ App }) =>
      App.addListener("backButton", (event) => {
        cb({ canGoBack: event.canGoBack === true });
      }),
    ),
  );
}

/**
 * Extract the in-app path from a deep-link URL.
 *
 * Only http(s) URLs are honoured — those are the Universal Link / App Link
 * shapes the app is configured for (`androidScheme: "https"` in
 * capacitor.config.ts). Anything else (a custom scheme, an OAuth callback,
 * a malformed URL) returns null so the caller leaves the user where they are
 * rather than navigating somewhere arbitrary.
 */
export function deepLinkPath(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.pathname === "" || parsed.pathname === "/") return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Subscribe to deep links (`appUrlOpen`) and emit the in-app path.
 *
 * The plugin fires this both on a cold start via a link and while the app is
 * already running. Non-http(s) URLs are dropped (see {@link deepLinkPath}).
 * Returns an unsubscribe function; safe (no-op) on web.
 */
export function subscribeToDeepLinks(cb: (path: string) => void): () => void {
  if (!isNativeShell()) return () => {};
  return toUnsubscribe(
    "appUrlOpen",
    import("@capacitor/app").then(({ App }) =>
      App.addListener("appUrlOpen", (event) => {
        const path = typeof event.url === "string" ? deepLinkPath(event.url) : null;
        if (path) cb(path);
      }),
    ),
  );
}

/**
 * Close the app. Android only — iOS has no supported way to terminate an app
 * programmatically, and calling this there is a no-op inside the plugin.
 * Errors are swallowed: failing to exit must not surface as a crash.
 */
export async function exitNativeApp(): Promise<void> {
  if (!isNativeShell()) return;
  try {
    const { App } = await import("@capacitor/app");
    await App.exitApp();
  } catch (err) {
    logger.warn("native_app_exit_failed", { error: String(err) });
  }
}
