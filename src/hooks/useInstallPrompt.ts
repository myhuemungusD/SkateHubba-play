import { useSyncExternalStore } from "react";
import { isNativePlatform } from "../services/nativeVideo";
import {
  getServerSnapshot,
  getSnapshot,
  promptInstall,
  subscribe,
  type InstallOutcome,
  type InstallStoreState,
} from "../lib/installPrompt";

/**
 * What the Settings "Install app" card should show:
 *  - `native`    — running inside the Capacitor shell; nothing to install.
 *  - `installed` — already running as an installed PWA (standalone display).
 *  - `prompt`    — Chromium parked a `beforeinstallprompt`; one tap installs.
 *  - `ios`       — iPhone/iPad: Safari's Share → "Add to Home Screen" only.
 *  - `manual`    — any other browser: point at the browser's own menu.
 */
export type InstallStatus = "native" | "installed" | "prompt" | "ios" | "manual";

export interface UseInstallPromptResult {
  status: InstallStatus;
  promptInstall: () => Promise<InstallOutcome>;
}

/** @internal exported for testing */
export function isStandaloneDisplay(): boolean {
  // iOS home-screen web apps expose the non-standard `navigator.standalone`
  // and older iOS versions do not honour the display-mode media query.
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
}

/** @internal exported for testing */
export function isIosDevice(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPadOS 13+ ships a desktop-Mac user agent; touch points tell it apart.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/** @internal exported for testing */
export function resolveInstallStatus(store: InstallStoreState): InstallStatus {
  if (isNativePlatform()) return "native";
  if (store === "installed" || isStandaloneDisplay()) return "installed";
  if (store === "prompt") return "prompt";
  if (isIosDevice()) return "ios";
  return "manual";
}

/**
 * Install state for the current runtime plus the action that opens the
 * browser's install dialog. Re-renders when `beforeinstallprompt` or
 * `appinstalled` fires (see src/lib/installPrompt.ts).
 */
export function useInstallPrompt(): UseInstallPromptResult {
  const store = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { status: resolveInstallStatus(store), promptInstall };
}
