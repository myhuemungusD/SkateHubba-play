/**
 * Native app-shell service (iOS + Android via Capacitor).
 *
 * Owns the shell-level integrations that have no web equivalent:
 *
 *  - Status bar: dark background + light icons so the OS chrome matches the
 *    app's #0A0A0A shell (see capacitor.config.ts backgroundColor).
 *  - Android hardware back button: registering a `backButton` listener on
 *    @capacitor/app REPLACES Capacitor's default WebView back behavior, so
 *    the handler must re-implement it — pop SPA history when there is
 *    somewhere to go back to, otherwise minimize the app (Android's expected
 *    "back from the root screen" behavior; minimize keeps the app warm where
 *    exitApp would cold-start it next launch).
 *  - Universal / App Links: an `appUrlOpen` for a claimed https URL is
 *    validated here and handed to the UI layer as a plain in-app path.
 *
 * `window.history.back()` still emits `popstate`, so in-app back absorbers
 * that push a sentinel history entry (e.g. TutorialOverlay) keep working
 * unchanged on top of this listener.
 *
 * This is the ONLY file allowed to import @capacitor/app and
 * @capacitor/status-bar (services-layer rule from CLAUDE.md). Every export
 * here is safe to call on web: they no-op / return a no-op unsubscribe.
 */

import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";

/** Must match `backgroundColor` in capacitor.config.ts — one shell color. */
const SHELL_BACKGROUND = "#0A0A0A";

/**
 * Hosts whose https links this app claims (Android App Links / iOS universal
 * links). `www.skatehubba.com` 301s to the apex on the web (see vercel.json
 * redirects) but the OS matches the host of the tapped URL before any
 * redirect happens, so both must be accepted here — and both must be
 * verified by the manifest / entitlements + the hosted association files.
 */
const DEEP_LINK_HOSTS = new Set(["skatehubba.com", "www.skatehubba.com"]);

/**
 * Style the OS status bar to match the dark app shell. Best-effort — a
 * status-bar failure must never block startup, so errors are logged and
 * swallowed. No-op on web.
 *
 * `Style.Dark` = light text on a dark background (the enum names the
 * background, not the text). Background color + overlay control are
 * Android-only APIs — iOS derives both from the WebView, guarded here so the
 * iOS bridge doesn't throw "unimplemented".
 */
export async function initStatusBar(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    if (Capacitor.getPlatform() === "android") {
      await StatusBar.setBackgroundColor({ color: SHELL_BACKGROUND });
      await StatusBar.setOverlaysWebView({ overlay: false });
    }
  } catch (err) {
    logger.warn("status_bar_init_failed", { error: parseFirebaseError(err) });
  }
}

/**
 * Route the Android hardware back button through SPA history.
 *
 * `canGoBack` is Capacitor's view of the WebView history stack: true → pop a
 * react-router entry via `window.history.back()`; false → we are at the root
 * screen, so minimize the app instead of letting the OS kill it.
 *
 * Returns an unsubscribe function. Safe to call on web (no-op unsubscribe) so
 * the entry point can mount it unconditionally. iOS never fires the event —
 * registering there is harmless.
 */
export function subscribeToBackButton(): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};

  let removed = false;
  const handle = App.addListener("backButton", (event) => {
    if (event.canGoBack) {
      window.history.back();
    } else {
      void App.minimizeApp().catch((err: unknown) => {
        logger.warn("minimize_app_failed", { error: parseFirebaseError(err) });
      });
    }
  }).catch((err: unknown) => {
    logger.warn("back_button_listener_failed", { error: parseFirebaseError(err) });
    return null;
  });

  return () => {
    if (removed) return;
    removed = true;
    void handle.then((h) => h?.remove()).catch(() => {});
  };
}

/**
 * Reduce an `appUrlOpen` URL to the in-app path the caller should route to,
 * or `null` when the URL is not an actionable deep link.
 *
 * Rejects, in order: unparseable URLs, non-http(s) schemes (custom-scheme
 * OAuth callbacks are Capacitor's business, not ours), foreign hosts, and
 * bare-origin links (`https://skatehubba.com/`) which carry no destination —
 * those should just open the app on whatever screen it was already on.
 */
function deepLinkPath(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    logger.warn("deep_link_unparseable");
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!DEEP_LINK_HOSTS.has(parsed.hostname)) return null;
  if (parsed.pathname === "/" || parsed.pathname === "") return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Deliver universal / App Link opens (`https://skatehubba.com/...` tapped
 * outside the app) to the caller as an in-app path, e.g. `/player/abc123`.
 *
 * The OS hands us the full URL; routing is the UI layer's job, so this
 * service only validates and normalizes. Returns an unsubscribe function and
 * is safe to call on web (no-op unsubscribe), same contract as
 * `subscribeToBackButton`.
 */
export function subscribeToDeepLinks(cb: (path: string) => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};

  let removed = false;
  const handle = App.addListener("appUrlOpen", (event) => {
    const path = deepLinkPath(event.url);
    if (path) cb(path);
  }).catch((err: unknown) => {
    logger.warn("deep_link_listener_failed", { error: parseFirebaseError(err) });
    return null;
  });

  return () => {
    if (removed) return;
    removed = true;
    void handle.then((h) => h?.remove()).catch(() => {});
  };
}
