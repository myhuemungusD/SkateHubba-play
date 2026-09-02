/**
 * Native app-shell service (iOS + Android via Capacitor).
 *
 * Owns the two shell-level integrations that have no web equivalent:
 *
 *  - Status bar: dark background + light icons so the OS chrome matches the
 *    app's #0A0A0A shell (see capacitor.config.ts backgroundColor).
 *  - Android hardware back button: registering a `backButton` listener on
 *    @capacitor/app REPLACES Capacitor's default WebView back behavior, so
 *    the handler must re-implement it — pop SPA history when there is
 *    somewhere to go back to, otherwise minimize the app (Android's expected
 *    "back from the root screen" behavior; minimize keeps the app warm where
 *    exitApp would cold-start it next launch).
 *
 * `window.history.back()` still emits `popstate`, so in-app back absorbers
 * that push a sentinel history entry (e.g. TutorialOverlay) keep working
 * unchanged on top of this listener.
 *
 * This is the ONLY file allowed to import @capacitor/app and
 * @capacitor/status-bar (services-layer rule from CLAUDE.md). Both functions
 * are safe to call on web: they no-op / return a no-op unsubscribe.
 */

import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";

/** Must match `backgroundColor` in capacitor.config.ts — one shell color. */
const SHELL_BACKGROUND = "#0A0A0A";

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
