import { useSyncExternalStore } from "react";
import { getNetworkSnapshot, subscribeToNetworkStatus } from "../services/nativeBridge";

/** @internal exported for testing */
export function getServerSnapshot(): boolean {
  return true;
}

/**
 * Returns `true` when the device reports a network connection, `false` when
 * offline. Backed by the OS reachability feed inside the Capacitor shell
 * (WKWebView pins `navigator.onLine` to `true`) and by the browser
 * `online`/`offline` events on web — see `services/nativeBridge`.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeToNetworkStatus, getNetworkSnapshot, getServerSnapshot);
}
