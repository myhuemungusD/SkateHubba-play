import { useCallback, useEffect, useState } from "react";
import { requestPushPermission as requestWebPushPermission } from "../../services/fcm";
import {
  getNativePushPermission,
  isPushSupported,
  registerPushToken,
  requestPushPermission as requestNativePushPermission,
} from "../../services/pushNotifications";
import { logger } from "../../services/logger";
import { fromNativePermission, readPushState, type PushState } from "./pushState";

/** OS-level push permission state for Settings, plus the "enable" action. */
export function usePushPermission(uid: string) {
  const [pushState, setPushState] = useState<PushState>(readPushState);
  const [requestingPush, setRequestingPush] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  // Native shells must go through the Capacitor plugin: the web pair in
  // services/fcm.ts bails out without window.Notification / serviceWorker, so
  // a native user could never reach the OS prompt through it.
  const nativePush = isPushSupported();

  // Resolve the real OS grant on native. `checkPermissions()` never raises the
  // system dialog, so this is safe to fire on mount — without it an
  // already-granted user sits on a phantom "Turn on notifications" card. The
  // read fails soft to "prompt", which lands back on the harmless opt-in card.
  useEffect(() => {
    if (!nativePush) return;
    let cancelled = false;
    void getNativePushPermission().then((permission) => {
      if (cancelled) return;
      setPushState(fromNativePermission(permission));
    });
    return () => {
      cancelled = true;
    };
  }, [nativePush]);

  const handleEnablePush = useCallback(async () => {
    setRequestingPush(true);
    setPushError(null);
    try {
      if (nativePush) {
        const permission = await requestNativePushPermission();
        setPushState(fromNativePermission(permission));
        if (permission === "granted") {
          // Explicit user gesture — bypass the pref re-read so an optimistic
          // toggle whose write hasn't landed can't silently drop the token.
          await registerPushToken(uid, { assumeEnabled: true });
        } else if (permission === "denied") {
          setPushError("Notifications were blocked. Enable them in your device settings and try again.");
        } else {
          setPushError("Couldn't enable notifications. Please try again.");
        }
        return;
      }
      const token = await requestWebPushPermission(uid);
      const next = readPushState();
      setPushState(next);
      if (!token && next === "denied") {
        setPushError("Notifications were blocked. Enable them in system settings and try again.");
      } else if (!token) {
        setPushError("Couldn't enable notifications. Please try again.");
      }
    } catch (err) {
      logger.warn("settings_push_request_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      setPushError("Something went wrong. Please try again.");
    } finally {
      setRequestingPush(false);
    }
  }, [uid, nativePush]);

  return { pushState, requestingPush, pushError, nativePush, handleEnablePush };
}
