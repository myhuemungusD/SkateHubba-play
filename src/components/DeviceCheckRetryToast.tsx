import { useEffect } from "react";
import { useNotifications } from "../context/NotificationContext";
import { setDeviceCheckPrompt } from "../services/closetAppCheck";

/**
 * Shows the retry toast when a closet action can't verify the device
 * (reCAPTCHA blocked, offline, or the token exchange failed). Retry re-runs
 * the same action; dismissing it lets the screen show its own error.
 * Renders nothing.
 */
export function DeviceCheckRetryToast(): null {
  const { notify } = useNotifications();

  useEffect(() => {
    setDeviceCheckPrompt((decide) => {
      notify({
        type: "error",
        title: "Couldn't verify this device",
        message: "Check your connection and run it back.",
        action: {
          label: "Retry",
          onAction: () => decide(true),
          onExpire: () => decide(false),
        },
      });
    });
    return () => setDeviceCheckPrompt(null);
  }, [notify]);

  return null;
}
