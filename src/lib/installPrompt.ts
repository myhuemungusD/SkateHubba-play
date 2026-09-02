/**
 * Install-prompt capture for the web PWA.
 *
 * Chromium browsers (desktop Chrome/Edge + Android Chrome) fire a single
 * `beforeinstallprompt` event per page load once `public/manifest.json`
 * passes the installability checks. That event object is the ONLY handle
 * that can open the browser's install dialog, and it fires early — usually
 * before the user has navigated anywhere near Settings. So main.tsx calls
 * `captureInstallPrompt()` at startup and this module parks the event; the
 * `useInstallPrompt` hook (src/hooks) reads it through the external-store
 * API below and the Settings "Install app" card triggers `promptInstall()`.
 *
 * Safari (iOS + macOS) and Firefox never fire the event — there the UI falls
 * back to manual "Add to Home Screen" instructions.
 *
 * There is deliberately no app service worker: `public/sw-cleanup.js`
 * unregisters everything except the FCM push worker, and Chrome 120+ no
 * longer requires a service worker for installability.
 */
import { analytics } from "../services/analytics";

/** Non-standard Chromium event — not in lib.dom. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/** What the store knows, independent of platform detection. */
export type InstallStoreState = "none" | "prompt" | "installed";

/** Result of `promptInstall()`. */
export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
let captured = false;
/** True while the browser's install dialog is open — guards a double-tap. */
let prompting = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of listeners) cb();
}

function onBeforeInstallPrompt(event: Event): void {
  // Suppress Chrome's own mini-infobar so the install offer is a deliberate
  // tap from Settings rather than a banner sliding over the auth screen.
  event.preventDefault();
  deferredPrompt = event as BeforeInstallPromptEvent;
  emit();
}

function onAppInstalled(): void {
  deferredPrompt = null;
  installed = true;
  analytics.appInstalled();
  emit();
}

/**
 * Attach the window listeners. Idempotent within one module instance — a
 * second call (tests, a duplicated import) is a no-op so the same event can
 * never be parked twice.
 */
export function captureInstallPrompt(): void {
  if (captured) return;
  captured = true;
  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);
}

/** @internal exported for `useSyncExternalStore` */
export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** @internal exported for `useSyncExternalStore` */
export function getSnapshot(): InstallStoreState {
  if (installed) return "installed";
  return deferredPrompt ? "prompt" : "none";
}

/** @internal exported for `useSyncExternalStore` */
export function getServerSnapshot(): InstallStoreState {
  return "none";
}

/**
 * Open the browser's install dialog. Must run inside a user gesture.
 *
 * The parked event stays in the store while the dialog is open, so an
 * unrelated re-render of Settings mid-dialog still reads "prompt" and the
 * card behind the native sheet does not flicker; `prompting` is what stops
 * a double-tap from calling `prompt()` twice. The event is single-use either
 * way — consumed on answer, dead if the browser threw — so it is dropped and
 * subscribers notified only once the outcome is known. A dismissal leaves
 * the store at "none": Chrome will not re-fire `beforeinstallprompt` this
 * page load, so the UI drops back to the manual instructions.
 *
 * Rejects if the browser refuses to open the dialog (e.g. the parked event
 * went stale); callers must catch.
 */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferredPrompt;
  if (!event || prompting) return "unavailable";
  prompting = true;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") installed = true;
    analytics.installPromptAnswered(outcome);
    return outcome;
  } finally {
    deferredPrompt = null;
    prompting = false;
    emit();
  }
}

/** @internal test-only — detach listeners and wipe module state. */
export function __resetInstallPromptForTest(): void {
  if (captured) {
    window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.removeEventListener("appinstalled", onAppInstalled);
  }
  captured = false;
  deferredPrompt = null;
  installed = false;
  prompting = false;
  listeners.clear();
}
