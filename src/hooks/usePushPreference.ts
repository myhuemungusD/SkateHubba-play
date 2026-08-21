import { useCallback, useEffect, useState } from "react";
import { getPushEnabled, setPushEnabled } from "../services/pushPreferences";
import { logger } from "../services/logger";

const SAVE_ERROR = "Couldn't save that preference. Please try again.";

export interface PushPreference {
  /** Current preference. Optimistic — reverts if the write throws. */
  enabled: boolean;
  /** True until the initial read for this uid resolves. */
  loading: boolean;
  /** Non-null when the last write failed. Cleared on the next attempt. */
  error: string | null;
  /** Fire-and-forget setter; the promise is handled internally. */
  setEnabled: (next: boolean) => void;
}

/**
 * Push notification preference for the Settings toggle.
 *
 * Push is ON by default (see `services/pushPreferences`), so both the initial
 * state and a failed read resolve to enabled rather than silently muting the
 * user. Writes are optimistic — the switch flips immediately and reverts if
 * `setPushEnabled` throws, at which point `onError` fires so the screen can
 * surface a toast.
 *
 * State is stored as a `{ uid, enabled }` pair rather than a separate loading
 * flag: a uid change then reads as "not loaded yet" without a setState in the
 * effect body (which cascades renders — see `react-hooks/set-state-in-effect`).
 */
export function usePushPreference(uid: string, onError?: (message: string) => void): PushPreference {
  const [pref, setPref] = useState<{ uid: string; enabled: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPushEnabled(uid)
      .catch(() => true)
      .then((value) => {
        if (cancelled) return;
        setPref({ uid, enabled: value });
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const loading = pref?.uid !== uid;
  const enabled = loading ? true : pref.enabled;

  const setEnabled = useCallback(
    (next: boolean) => {
      setPref({ uid, enabled: next });
      setError(null);
      void setPushEnabled(uid, next).catch((err: unknown) => {
        logger.warn("push_pref_save_failed", {
          uid,
          error: err instanceof Error ? err.message : String(err),
        });
        setPref({ uid, enabled: !next });
        setError(SAVE_ERROR);
        onError?.(SAVE_ERROR);
      });
    },
    [uid, onError],
  );

  return { enabled, loading, error, setEnabled };
}
