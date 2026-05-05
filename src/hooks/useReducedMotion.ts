import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Resolve the active MediaQueryList lazily so SSR / non-browser environments
 * (where `window.matchMedia` is undefined) don't blow up at module load. The
 * result is cached for the life of the page so all consumers subscribe to a
 * single MediaQueryList instance.
 */
let cachedMql: MediaQueryList | null = null;
function getMql(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  if (cachedMql === null) cachedMql = window.matchMedia(QUERY);
  return cachedMql;
}

/** @internal exported for testing */
export function subscribe(cb: () => void): () => void {
  const mql = getMql();
  if (!mql) return () => undefined;
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

/** @internal exported for testing */
export function getSnapshot(): boolean {
  const mql = getMql();
  return mql ? mql.matches : false;
}

/** @internal exported for testing */
export function getServerSnapshot(): boolean {
  return false;
}

/** @internal exported for testing */
export function __resetCachedMqlForTest(): void {
  cachedMql = null;
}

/**
 * Returns `true` when the user has requested reduced motion via OS settings,
 * `false` otherwise. SSR-safe: returns `false` when `window.matchMedia` is
 * unavailable. Subscribes to MediaQueryList `change` events so toggling the
 * preference at runtime updates consuming components.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
