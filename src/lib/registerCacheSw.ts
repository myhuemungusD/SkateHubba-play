import { runAfterQuiet } from "./scheduleIdle";
import { isMessagingWorkerClaimed } from "./swClaim";

function scriptUrl(registration: ServiceWorkerRegistration): string {
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  return worker?.scriptURL ?? "";
}

function isMessaging(registration: ServiceWorkerRegistration): boolean {
  return scriptUrl(registration).includes("firebase-messaging-sw");
}

let started = false;

function isNative(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

/**
 * Install the same-origin asset cache on idle. Skips when push already
 * owns the page scope — that worker imports the same cache handlers.
 * No-ops in tests and inside the native shell.
 */
export function registerCacheWorker(opts?: { enabled?: boolean }): void {
  const enabled = opts?.enabled ?? import.meta.env.MODE !== "test";
  if (!enabled || started) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (isNative()) return;
  started = true;
  runAfterQuiet(() => {
    void installCacheWorker();
  });
}

async function installCacheWorker(): Promise<void> {
  if (isMessagingWorkerClaimed()) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    if (isMessagingWorkerClaimed() || regs.some(isMessaging)) return;
    await navigator.serviceWorker.register("/asset-cache-sw.js");
  } catch {
    started = false;
  }
}

/** @internal */
export function __resetCacheWorkerForTest(): void {
  started = false;
}
