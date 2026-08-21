import { useEffect, useState } from "react";
import { requestPushPermission as requestWebPushPermission } from "../services/fcm";
import {
  getNativePushPermission,
  isPushSupported,
  registerPushToken,
  requestPushPermission as requestNativePushPermission,
} from "../services/pushNotifications";
import { Btn } from "./ui/Btn";

const DISMISSED_KEY = "push_banner_dismissed";

function dismissed(): boolean {
  return localStorage.getItem(DISMISSED_KEY) === "1";
}

function shouldShowBanner(): boolean {
  if (typeof window === "undefined") return false;
  if (dismissed()) return false;
  // Native (Capacitor): `Notification.permission` describes the WebView, not
  // the OS grant, and the real grant is only readable asynchronously. Start
  // hidden and let the mount effect reveal the banner when permission is
  // genuinely prompt-able — starting visible would flash an opt-in at users
  // who already granted.
  if (isPushSupported()) return false;
  if (!("Notification" in window)) return false;
  if (Notification.permission !== "default") return false;
  return true;
}

/**
 * Banner prompting users to enable push notifications.
 * Shown only while permission has not been decided — `Notification.permission`
 * on web, the native plugin's `checkPermissions()` on a Capacitor shell.
 */
export function PushPermissionBanner({ uid }: { uid: string }) {
  const [visible, setVisible] = useState(shouldShowBanner);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Native-only permission read. Never prompts, so it's safe on mount.
  useEffect(() => {
    if (!isPushSupported() || dismissed()) return;
    let cancelled = false;
    void getNativePushPermission().then((permission) => {
      if (!cancelled && permission === "prompt") setVisible(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="mx-5 mt-3 p-4 rounded-2xl bg-surface/80 backdrop-blur-sm border border-border animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-sm text-white mb-1">Enable push notifications?</p>
          <p className="font-body text-xs text-muted">
            Get notified when it&apos;s your turn, when you receive a challenge, and when games end.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(DISMISSED_KEY, "1");
            setVisible(false);
          }}
          className="text-faint hover:text-white text-lg leading-none shrink-0"
          aria-label="Dismiss"
        >
          &times;
        </button>
      </div>
      {error && <p className="font-body text-xs text-brand-red mt-2">{error}</p>}
      <div className="mt-3">
        <Btn
          variant="primary"
          disabled={requesting}
          onClick={async () => {
            setRequesting(true);
            setError(null);
            try {
              if (isPushSupported()) {
                const permission = await requestNativePushPermission();
                if (permission === "granted") {
                  // Explicit user gesture — skip the pref re-read (see
                  // RegisterPushTokenOptions.assumeEnabled).
                  await registerPushToken(uid, { assumeEnabled: true });
                  localStorage.setItem(DISMISSED_KEY, "1");
                  setVisible(false);
                } else if (permission === "denied") {
                  setError("Notifications were blocked. Enable them in your device settings and try again.");
                } else {
                  setError("Could not enable notifications. Please try again.");
                }
                return;
              }
              const token = await requestWebPushPermission(uid);
              if (token) {
                localStorage.setItem(DISMISSED_KEY, "1");
                setVisible(false);
              } else if (Notification.permission === "denied") {
                setError("Notifications were blocked. Enable them in your browser settings and try again.");
              } else {
                setError("Could not enable notifications. Please try again.");
              }
            } catch {
              setError("Something went wrong. Please try again.");
            } finally {
              setRequesting(false);
            }
          }}
        >
          {requesting ? "Enabling..." : "Enable Notifications"}
        </Btn>
      </div>
    </div>
  );
}
