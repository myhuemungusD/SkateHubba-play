/**
 * Closet-only App Check for the website.
 *
 * Every closet callable enforces App Check on the server. The website keeps
 * sitewide App Check off (VITE_APPCHECK_ENABLED unset) because reCAPTCHA on
 * every page load costs money. In "lazy" mode (VITE_APPCHECK_WEB_MODE, the
 * default) nothing loads at app start: the first closet action loads the
 * reCAPTCHA v3 script, starts App Check once, and each closet call then sends
 * a limited-use token (one reCAPTCHA check per action, no background refresh).
 *
 * The sitewide switch and the native apps keep their own path through
 * firebase.ensureAppCheck(); this module only adds the lazy web path.
 */
import { Capacitor } from "@capacitor/core";
import * as firebase from "../firebase";
import { env } from "../lib/env";
import { captureMessage } from "../lib/sentry";
import { logger } from "./logger";

/** Same URL firebase/app-check loads for ReCaptchaV3Provider. */
export const RECAPTCHA_V3_URL = "https://www.google.com/recaptcha/api.js";
export const RECAPTCHA_LOAD_TIMEOUT_MS = 15_000;

/** Shown by the closet screens if the person dismisses the retry toast. */
export const DEVICE_CHECK_FAILED_MESSAGE = "Couldn't verify this device. Try again.";

/** The device check (reCAPTCHA + App Check) failed before or during a closet call. */
export class DeviceCheckError extends Error {
  readonly code = "device_check_failed";
  constructor() {
    super(DEVICE_CHECK_FAILED_MESSAGE);
    this.name = "DeviceCheckError";
  }
}

/** True when closet calls on this build should start App Check lazily. */
export function usesLazyWebAppCheck(): boolean {
  return (
    env !== null && !env.VITE_APPCHECK_ENABLED && env.VITE_APPCHECK_WEB_MODE === "lazy" && !Capacitor.isNativePlatform()
  );
}

let ready: Promise<void> | null = null;

/**
 * Make sure App Check can mint a token for a closet call. Lazy web mode loads
 * reCAPTCHA and starts App Check once; a failure clears the cached promise so
 * the next attempt (the retry toast) loads it again. Every other build defers
 * to the existing sitewide/native path.
 */
export function ensureClosetAppCheck(): Promise<void> {
  if (!usesLazyWebAppCheck()) return firebase.ensureAppCheck();
  ready ??= installLazy().catch((err: unknown) => {
    ready = null;
    throw err;
  });
  return ready;
}

async function installLazy(): Promise<void> {
  const app = firebase.default;
  if (!app) throw new Error("Firebase not initialized");
  const siteKey = env?.VITE_RECAPTCHA_SITE_KEY;
  if (!siteKey) {
    logger.error("appcheck_lazy_no_site_key", { hint: "closet calls need VITE_RECAPTCHA_SITE_KEY on web" });
    captureMessage("Closet App Check is lazy but VITE_RECAPTCHA_SITE_KEY is missing", "error");
    throw new DeviceCheckError();
  }
  if (firebase.isEmulatorMode) {
    // Same as firebase.ts: the debug provider only ever runs against emulators.
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  try {
    // Load reCAPTCHA ourselves first: the SDK's own loader has no error or
    // timeout path, so a blocked script would leave the call hanging, and the
    // SDK never reloads it. The SDK reuses window.grecaptcha when present.
    await loadRecaptchaScript();
    const { initializeAppCheck, ReCaptchaV3Provider } = await import("firebase/app-check");
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      // No background refresh: closet calls ask for a limited-use token each time.
      isTokenAutoRefreshEnabled: false,
    });
    logger.info("appcheck_lazy_initialized", {});
  } catch (err) {
    logger.warn("appcheck_lazy_init_failed", { message: err instanceof Error ? err.message : String(err) });
    throw new DeviceCheckError();
  }
}

function loadRecaptchaScript(): Promise<void> {
  const w = window as unknown as { grecaptcha?: unknown };
  if (w.grecaptcha) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = RECAPTCHA_V3_URL;
    script.async = true;
    const done = (err?: Error): void => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (!err && w.grecaptcha) return resolve();
      script.remove();
      reject(err ?? new Error("recaptcha_missing_after_load"));
    };
    const timer = setTimeout(() => done(new Error("recaptcha_load_timeout")), RECAPTCHA_LOAD_TIMEOUT_MS);
    script.onload = () => done();
    script.onerror = () => done(new Error("recaptcha_load_failed"));
    document.head.appendChild(script);
  });
}

/**
 * True for errors that mean "this device could not be verified": our own
 * load failure, an App Check SDK error (reCAPTCHA or token exchange), or the
 * server's App Check rejection.
 */
export function isDeviceCheckFailure(err: unknown): boolean {
  if (err instanceof DeviceCheckError) return true;
  if (typeof err !== "object" || err === null) return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  if (typeof code !== "string") return false;
  if (code.startsWith("appCheck/")) return true;
  // firebase-functions answers a missing or invalid App Check token with
  // unauthenticated / "Unauthenticated" (our handlers use lowercase codes).
  if (code === "functions/unauthenticated" && message === "Unauthenticated") return true;
  return code === "functions/failed-precondition" && message === "app_check_required";
}

/**
 * Retry prompt. The UI (DeviceCheckRetryToast) registers a handler that shows
 * a toast and calls `decide(true)` on Retry or `decide(false)` when the toast
 * is dismissed or times out. With no handler mounted the call fails at once,
 * so the screen still shows its own error; it is never silent.
 */
export type DeviceCheckPrompt = (decide: (retry: boolean) => void) => void;

let prompt: DeviceCheckPrompt | null = null;

export function setDeviceCheckPrompt(handler: DeviceCheckPrompt | null): void {
  prompt = handler;
}

export function askDeviceCheckRetry(): Promise<boolean> {
  const handler = prompt;
  if (!handler) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    handler((retry) => {
      if (settled) return;
      settled = true;
      resolve(retry);
    });
  });
}
