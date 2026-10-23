import { useCallback } from "react";
import type { UserProfile } from "../../services/users";
import { useNotifications } from "../../context/NotificationContext";
import { usePushPreference } from "../../hooks/usePushPreference";
import { Btn } from "../../components/ui/Btn";
import { usePushPermission } from "./usePushPermission";
import { PrefRow } from "./SettingsPrimitives";

/**
 * Settings → Notifications: the push preference switch plus the OS-grant
 * card under it. Lifted out of Settings.tsx unchanged.
 */
export function PushSettings({ uid }: { uid: UserProfile["uid"] }) {
  const { notify } = useNotifications();
  // Push permission is a tri-state that only transitions via browser/OS
  // prompts — we read once on mount and refresh after a user-initiated
  // enable. `unsupported` fires on desktop Safari + older browsers.
  const { pushState, requestingPush, pushError, nativePush, handleEnablePush } = usePushPermission(uid);

  // Push preference — the only place in the app where push can be switched
  // off. Independent of the OS permission above: turning it back on never
  // prompts, it just re-arms delivery for a device that already has (or later
  // grants) permission.
  const handlePushPrefError = useCallback(
    (message: string) => {
      notify({ type: "error", title: "Preference not saved", message });
    },
    [notify],
  );
  const pushPref = usePushPreference(uid, handlePushPrefError);

  return (
    <div className="space-y-2">
      <PrefRow
        title="Push notifications"
        description="Turn off to stop all pushes — turns, challenges, nudges, and results."
        checked={pushPref.enabled}
        onChange={pushPref.setEnabled}
        disabled={pushPref.loading}
        trailing={
          pushPref.error ? (
            <p role="alert" className="font-body text-label text-brand-red">
              {pushPref.error}
            </p>
          ) : /* Mismatch: the preference is on but the OS grant isn't.
                 On native we can't read the grant, so anything short of a
                 confirmed "granted" counts — the card below carries the
                 prompt action while permission is still prompt-able. */
          pushPref.enabled && (pushState === "denied" || (nativePush && pushState !== "granted")) ? (
            <p className="font-body text-label text-subtle">Enable notifications in your device settings</p>
          ) : undefined
        }
      />
      {/* Permission blocks describe the OS-level grant. They're only
          meaningful while the preference above is on — with push switched
          off, "Push notifications on" would be a lie. */}
      {pushPref.enabled && pushState === "unsupported" && (
        <div className="p-4">
          <p className="font-body text-xs text-faint">
            Push notifications aren&apos;t supported in this browser. Use a recent version of Chrome, Safari, or Firefox
            — or install SkateHubba to your home screen.
          </p>
        </div>
      )}
      {pushPref.enabled && pushState === "granted" && (
        <div className="flex items-center gap-3 p-4 rounded-2xl glass-card">
          <span
            className="w-2 h-2 rounded-full bg-brand-green shadow-[0_0_8px_rgba(0,230,118,0.5)]"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="font-display text-sm text-white">Push notifications on</p>
            <p className="font-body text-xs text-faint mt-1">
              You&apos;ll hear from us when it&apos;s your turn, when you&apos;re challenged, and when a game ends.
            </p>
          </div>
        </div>
      )}
      {pushPref.enabled && pushState === "default" && (
        <div className="p-4 rounded-2xl glass-card">
          <p className="font-display text-sm text-white mb-1">Enable push notifications</p>
          <p className="font-body text-xs text-faint mb-3">
            Get notified the moment it&apos;s your turn. You can turn this off any time in your{" "}
            {nativePush ? "device settings" : "browser or system settings"}.
          </p>
          <Btn variant="secondary" onClick={handleEnablePush} disabled={requestingPush}>
            {requestingPush ? "Enabling…" : nativePush ? "Turn on notifications" : "Enable Notifications"}
          </Btn>
          {pushError && (
            <p role="alert" className="font-body text-xs text-brand-red mt-2">
              {pushError}
            </p>
          )}
        </div>
      )}
      {pushPref.enabled && pushState === "denied" && (
        <div className="p-4 rounded-2xl border border-brand-red/25 bg-brand-red/[0.06]">
          <p className="font-display text-sm text-white mb-1">Notifications blocked</p>
          <p className="font-body text-xs text-faint">
            {nativePush
              ? "You've blocked SkateHubba from sending notifications. Re-enable them in your device settings, then reopen the app."
              : "You've blocked SkateHubba from sending notifications. Re-enable them from your browser or system settings, then reload this page."}
          </p>
        </div>
      )}
    </div>
  );
}
