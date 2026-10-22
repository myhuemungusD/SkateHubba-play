import { useCallback, useSyncExternalStore } from "react";

/**
 * One-shot "you're too young" notice that outlives the sign-in it was about.
 *
 * ProfileSetup's under-13 block deletes the Auth account (see
 * services/auth.underage.ts). That flips the app to signed-out and routes to
 * the landing page, unmounting ProfileSetup's own blocked card, so the landing
 * shows it instead. sessionStorage keeps it across that re-route and a reload
 * of the same tab, but not into a new visit.
 */
const KEY = "coppa_blocked_notice";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function write(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(KEY, "1");
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked (private mode): the notice just won't persist.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markCoppaBlocked(): void {
  write(true);
}

/** [shown, dismiss] for the landing page's blocked card. */
export function useCoppaBlockedNotice(): [boolean, () => void] {
  const shown = useSyncExternalStore(subscribe, read, read);
  const dismiss = useCallback(() => write(false), []);
  return [shown, dismiss];
}
