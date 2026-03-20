import { useSyncExternalStore } from "react";

/** @internal exported for testing */
export function subscribe(cb: () => void): () => void {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** @internal exported for testing */
export function getSnapshot(): boolean {
  return navigator.onLine;
}

/** @internal exported for testing */
export function getServerSnapshot(): boolean {
  return true;
}

/** Returns `true` when the browser reports a network connection, `false` when offline. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
