import { useCallback, useSyncExternalStore } from "react";

/**
 * Two pieces of COPPA state that outlive the screen that blocked an under-13.
 *
 * 1. The landing notice. ProfileSetup's under-13 block removes the Google or
 *    Apple sign-in (services/auth.underage.ts). That flips the app to
 *    signed-out and routes to the landing page, unmounting ProfileSetup's own
 *    blocked card, so the landing shows it instead. It stores whether the
 *    sign-in is already gone ("deleted") or only signed out and queued for
 *    deletion ("pending"), so the card never claims more than happened.
 *    sessionStorage keeps it across that re-route and a reload of the same
 *    tab, but not into a new visit. Dismissing it clears it.
 *
 * 2. The sticky block. Once a date of birth is blocked, every DOB submit on
 *    this device blocks again for 24 hours, whatever date is entered. That is
 *    the FTC COPPA FAQ's "prevent back-buttoning": without it, Go Back and a
 *    new date would get the same child through. Dismissing the notice never
 *    clears it, and it holds only an expiry time, never the age or the date.
 */
export type CoppaOutcome = "deleted" | "pending";

const NOTICE_KEY = "coppa_blocked_notice";
const STICKY_KEY = "age_gate_blocked";
const STICKY_MS = 24 * 60 * 60 * 1000;
const listeners = new Set<() => void>();

function readNotice(): CoppaOutcome | null {
  try {
    const v = sessionStorage.getItem(NOTICE_KEY);
    return v === "deleted" || v === "pending" ? v : null;
  } catch {
    return null;
  }
}

function writeNotice(outcome: CoppaOutcome | null): void {
  try {
    if (outcome) sessionStorage.setItem(NOTICE_KEY, outcome);
    else sessionStorage.removeItem(NOTICE_KEY);
  } catch {
    // Storage blocked (private mode): the notice just won't persist.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markCoppaBlocked(outcome: CoppaOutcome): void {
  writeNotice(outcome);
}

/** [outcome or null when there is no notice, dismiss] for the landing page's blocked card. */
export function useCoppaBlockedNotice(): [CoppaOutcome | null, () => void] {
  const outcome = useSyncExternalStore(subscribe, readNotice, readNotice);
  const dismiss = useCallback(() => writeNotice(null), []);
  return [outcome, dismiss];
}

export function markAgeGateBlocked(): void {
  try {
    localStorage.setItem(STICKY_KEY, String(Date.now() + STICKY_MS));
  } catch {
    // Storage blocked: the block still applies to this submit.
  }
}

/** True while a DOB block from the last 24 hours is on record for this device. */
export function isAgeGateBlocked(): boolean {
  try {
    const until = Number(localStorage.getItem(STICKY_KEY));
    if (until > Date.now()) return true;
    localStorage.removeItem(STICKY_KEY);
  } catch {
    // Storage blocked: nothing on record.
  }
  return false;
}
