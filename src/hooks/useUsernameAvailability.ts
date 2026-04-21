import { useCallback, useEffect, useRef, useState } from "react";
import { isUsernameAvailable, USERNAME_MIN } from "../services/users";

const DEBOUNCE_MS = 400;
const RETRY_DELAY_MS = 1500;
// Firestore normally answers a single-doc read in well under a second. Capping
// each probe at 6s means a genuinely hung request (App Check stall, offline
// cache miss that never completes) surfaces as a transient error instead of
// leaving the hook pending forever — which used to trap users on the profile
// setup screen with a permanently-disabled "Lock It In" button.
const PROBE_TIMEOUT_MS = 6000;

class ProbeTimeoutError extends Error {
  constructor() {
    super("username availability probe timed out");
    this.name = "ProbeTimeoutError";
  }
}

function probeWithTimeout(username: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProbeTimeoutError()), PROBE_TIMEOUT_MS);
    isUsernameAvailable(username).then(
      (ok) => {
        clearTimeout(timer);
        resolve(ok);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export interface UsernameAvailabilityState {
  /** `true` available, `false` taken, `null` unknown (too short, checking, or errored). */
  available: boolean | null;
  /** Error message shown to the user when the check couldn't complete. */
  error: string;
  /** Clear the transient error message (e.g. banner dismiss). */
  clearError: () => void;
}

/**
 * Debounced availability check for a proposed username. Returns `null` while
 * the username is too short or the check is in flight; `true`/`false` after
 * the service answers. On transient permission errors (the Firestore SDK may
 * not have the auth token immediately after Google sign-in) the check retries
 * once after a short delay before surfacing an error.
 */
export function useUsernameAvailability(username: string): UsernameAvailabilityState {
  // Track the result alongside the username it applies to. When `username`
  // differs from `result.for`, we treat `available` as null — this avoids a
  // synchronous setState at the top of the effect (which trips
  // react-hooks/set-state-in-effect) while still resetting the UI instantly.
  const [result, setResult] = useState<{ for: string; available: boolean | null; error: string }>({
    for: "",
    available: null,
    error: "",
  });
  const checkRef = useRef(0);
  const clearError = useCallback(() => {
    setResult((r) => (r.error ? { ...r, error: "" } : r));
  }, []);

  useEffect(() => {
    const normalized = username.trim();
    if (normalized.length < USERNAME_MIN) return;

    const id = ++checkRef.current;
    const timeout = setTimeout(async () => {
      try {
        const ok = await probeWithTimeout(normalized);
        /* v8 ignore start -- debounce guard; race between setTimeout and ref counter untestable in unit tests */
        if (checkRef.current === id) setResult({ for: username, available: ok, error: "" });
        /* v8 ignore stop */
      } catch {
        // After Google sign-in the Firestore SDK may not have the auth token
        // yet, causing a transient permission-denied. Retry once after a short
        // delay before surfacing the error to the user.
        /* v8 ignore start -- debounce guard; same race condition as above */
        if (checkRef.current !== id) return;
        try {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          if (checkRef.current !== id) return;
          const ok = await probeWithTimeout(normalized);
          if (checkRef.current === id) setResult({ for: username, available: ok, error: "" });
        } catch {
          if (checkRef.current === id) {
            setResult({ for: username, available: null, error: "Could not check username — try again" });
          }
        }
        /* v8 ignore stop */
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [username]);

  // Only surface the result if it matches the current username — otherwise the
  // last resolved value is stale and the UI should treat it as "unknown".
  const matches = result.for === username;
  return {
    available: matches ? result.available : null,
    error: matches ? result.error : "",
    clearError,
  };
}
