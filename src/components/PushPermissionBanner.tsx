import { useState } from "react";
import { requestPushPermission } from "../services/fcm";
import { Btn } from "./ui/Btn";

const DISMISSED_KEY = "push_banner_dismissed";

function shouldShowBanner(): boolean {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window)) return false;
  if (Notification.permission !== "default") return false;
  if (localStorage.getItem(DISMISSED_KEY) === "1") return false;
  return true;
}

/**
 * Banner prompting users to enable push notifications.
 * Only shown when the browser supports notifications and permission is "default" (not yet asked).
 */
export function PushPermissionBanner({ uid }: { uid: string }) {
  const [visible, setVisible] = useState(shouldShowBanner);
  const [requesting, setRequesting] = useState(false);

  if (!visible) return null;

  return (
    <div className="mx-5 mt-3 p-4 rounded-xl bg-surface border border-border animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-sm text-white mb-1">Enable push notifications?</p>
          <p className="font-body text-xs text-[#888]">
            Get notified when it&apos;s your turn or when someone nudges you.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(DISMISSED_KEY, "1");
            setVisible(false);
          }}
          className="text-[#666] hover:text-white text-lg leading-none shrink-0"
          aria-label="Dismiss"
        >
          &times;
        </button>
      </div>
      <div className="mt-3">
        <Btn
          variant="primary"
          disabled={requesting}
          onClick={async () => {
            setRequesting(true);
            await requestPushPermission(uid);
            localStorage.setItem(DISMISSED_KEY, "1");
            setVisible(false);
          }}
        >
          {requesting ? "Enabling..." : "Enable Notifications"}
        </Btn>
      </div>
    </div>
  );
}
