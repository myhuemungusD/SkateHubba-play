import { useCallback, useState } from "react";
import { AppCredits } from "../components/AppCredits";
import { isClosetStudioEnabled } from "../lib/featureFlags";
import { Link } from "react-router";
import type { UserProfile } from "../services/users";
import type { SaveFileResult } from "../services/nativeBridge";
import { unblockUser } from "../services/blocking";
import { useBlockedUsers } from "../hooks/useBlockedUsers";
import { isHapticsEnabled, setHapticsEnabled, playHaptic } from "../services/haptics";
import { useNotifications } from "../context/NotificationContext";
import { usePushPreference } from "../hooks/usePushPreference";
import { useInstallPrompt } from "../hooks/useInstallPrompt";
import { Btn } from "../components/ui/Btn";
import { ChevronLeftIcon } from "../components/icons";
import { useOnboardingContext } from "../context/OnboardingContext";
import { AvatarPicker } from "../components/AvatarPicker";
import { InstallAppCard } from "../components/InstallAppCard";
import { AccountActions } from "../components/AccountActions";
import { TwoFactorSection } from "../components/TwoFactorSection";
import { SmsTwoFactorSection } from "../components/SmsTwoFactorSection";
import { FollowLinks } from "./settings/FollowLinks";
import { TrainingConsentToggle } from "../components/TrainingConsentToggle";
import { SafetyReportsSection } from "../components/SafetyReportsSection";
import { usePushPermission } from "./settings/usePushPermission";
import { PrefRow, SectionHeader } from "./settings/SettingsPrimitives";
import { BlockedPlayersList } from "./settings/BlockedPlayersList";
import { PresenceSettings } from "./settings/PresenceSettings";
import { TipsSettings } from "./settings/TipsSettings";
import { isSms2faEnabled } from "../lib/featureFlags";

/* ── Main Settings screen ───────────────────────────────── */

export function Settings({
  profile,
  onBack,
  onDownloadData,
  onDeleteAccount,
}: {
  profile: UserProfile;
  onBack: () => void;
  /** Data-export handler. Omit to hide the row (see {@link AccountActions}). */
  onDownloadData?: () => Promise<SaveFileResult | void>;
  /** Account-deletion handler. Omit to hide the row. */
  onDeleteAccount?: () => Promise<void>;
}) {
  const { soundEnabled, toggleSound, notify } = useNotifications();
  const { replay: replayTutorial } = useOnboardingContext();
  const [replayingTutorial, setReplayingTutorial] = useState(false);

  const handleReplayTutorial = useCallback(async () => {
    setReplayingTutorial(true);
    try {
      await replayTutorial();
      onBack();
    } finally {
      setReplayingTutorial(false);
    }
  }, [replayTutorial, onBack]);

  // Haptic preference — local state mirrors the localStorage-backed service
  // flag so the switch renders synchronously without a read-through on every
  // tick. On toggle we fire the relevant haptic (only when turning on) so the
  // user feels the preference take effect.
  const [haptics, setHaptics] = useState<boolean>(() => isHapticsEnabled());

  const handleToggleHaptics = useCallback((next: boolean) => {
    setHaptics(next);
    setHapticsEnabled(next);
    if (next) playHaptic("button_primary");
  }, []);

  // Push permission is a tri-state that only transitions via browser/OS
  // prompts — we read once on mount and refresh after a user-initiated
  // enable. `unsupported` fires on desktop Safari + older browsers.
  const { pushState, requestingPush, pushError, nativePush, handleEnablePush } = usePushPermission(profile.uid);

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
  const pushPref = usePushPreference(profile.uid, handlePushPrefError);

  const blockedUids = useBlockedUsers(profile.uid);

  // PWA install. Hidden entirely inside the Capacitor shell — the store app
  // is already installed, so the section would only confuse.
  const { status: installStatus, promptInstall } = useInstallPrompt();

  const handleUnblock = useCallback(
    async (uid: string) => {
      await unblockUser(profile.uid, uid);
    },
    [profile.uid],
  );

  const supportEmail = "support@skatehubba.com";
  const feedbackSubject = encodeURIComponent("SkateHubba feedback");
  const bugSubject = encodeURIComponent(`SkateHubba bug report — @${profile.username}`);

  // AvatarPicker is opened from the "Edit Avatar" entry below.
  // Local state keeps the sheet self-contained so we don't have to
  // thread a context through every Settings sub-section.
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);

  return (
    <div className="min-h-dvh pb-24 overflow-y-auto bg-[#0A0A0A]/80">
      {/* Header */}
      <div className="px-5 pt-safe pb-4 flex justify-between items-center border-b border-white/[0.04] glass">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 touch-target text-muted hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange rounded-lg"
          aria-label="Back to lobby"
        >
          <ChevronLeftIcon size={16} />
          <span className="font-body text-xs">Lobby</span>
        </button>
        <img
          src="/logonew.webp"
          alt=""
          draggable={false}
          className="h-5 w-auto select-none opacity-40"
          aria-hidden="true"
        />
        <div className="w-16" aria-hidden="true" />
      </div>

      <div className="px-5 pt-7 max-w-[430px] mx-auto">
        <h1 className="font-display text-fluid-4xl text-white mb-2 tracking-wide">Settings</h1>
        <p className="font-body text-sm text-muted mb-6">
          Security, notifications, sound, haptics, install, and blocked players.
        </p>

        {/* Profile picture */}
        <SectionHeader title="PROFILE PICTURE" />
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setAvatarPickerOpen(true)}
            className="block w-full text-left p-4 rounded-2xl glass-card hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <p className="font-display text-sm text-white tracking-wide">Edit Avatar</p>
            <p className="font-body text-xs text-faint mt-1">
              Replace your default avatar with a custom photo. Image is screened on-device before upload.
            </p>
          </button>
        </div>

        <SectionHeader title="SECURITY" />
        <TwoFactorSection />
        {isSms2faEnabled() && <SmsTwoFactorSection />}

        {/* Notifications */}
        <SectionHeader title="NOTIFICATIONS" />
        <div className="space-y-2">
          <PrefRow
            title="Push notifications"
            description="Turn off to stop all pushes — turns, challenges, nudges, and results."
            checked={pushPref.enabled}
            onChange={pushPref.setEnabled}
            disabled={pushPref.loading}
            trailing={
              pushPref.error ? (
                <p role="alert" className="font-body text-[11px] text-brand-red">
                  {pushPref.error}
                </p>
              ) : /* Mismatch: the preference is on but the OS grant isn't.
                     On native we can't read the grant, so anything short of a
                     confirmed "granted" counts — the card below carries the
                     prompt action while permission is still prompt-able. */
              pushPref.enabled && (pushState === "denied" || (nativePush && pushState !== "granted")) ? (
                <p className="font-body text-[11px] text-subtle">Enable notifications in your device settings</p>
              ) : undefined
            }
          />
          {/* Permission blocks describe the OS-level grant. They're only
              meaningful while the preference above is on — with push switched
              off, "Push notifications on" would be a lie. */}
          {pushPref.enabled && pushState === "unsupported" && (
            <div className="p-4 rounded-2xl border border-dashed border-border bg-surface/30 backdrop-blur-sm">
              <p className="font-body text-xs text-faint">
                Push notifications aren&apos;t supported in this browser. Use a recent version of Chrome, Safari, or
                Firefox — or install SkateHubba to your home screen.
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

        <SectionHeader title="TRICK AI" />
        <div className="space-y-2">
          <TrainingConsentToggle uid={profile.uid} />
        </div>

        {/* Sound & haptics */}
        <SectionHeader title="FEEDBACK" />
        <div className="space-y-2">
          <PrefRow
            title="Sound effects"
            description="Short chimes when it's your turn, on wins, and on challenges."
            checked={soundEnabled}
            onChange={toggleSound}
          />
          <PrefRow
            title="Haptics"
            description="Taptic feedback on button presses, wins, and nudges (native only)."
            checked={haptics}
            onChange={handleToggleHaptics}
          />
        </div>

        {/* Install as an app (web only) */}
        {installStatus !== "native" && (
          <>
            <SectionHeader title="INSTALL APP" />
            <div className="space-y-2">
              <InstallAppCard status={installStatus} onInstall={promptInstall} />
            </div>
          </>
        )}

        {/* Blocked players */}
        <PresenceSettings uid={profile.uid} />

        <SectionHeader title="BLOCKED PLAYERS" count={blockedUids.size} />
        <BlockedPlayersList currentUserUid={profile.uid} blockedUids={blockedUids} onUnblock={handleUnblock} />

        {/* Help & support */}
        <SectionHeader title="HELP & SUPPORT" />
        <div className="space-y-2">
          <a
            href={`mailto:${supportEmail}?subject=${bugSubject}`}
            className="block p-4 rounded-2xl glass-card hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <p className="font-display text-sm text-white tracking-wide">Report a bug</p>
            <p className="font-body text-xs text-faint mt-1">Email our team — include a screenshot if you can.</p>
          </a>
          <a
            href={`mailto:${supportEmail}?subject=${feedbackSubject}`}
            className="block p-4 rounded-2xl glass-card hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <p className="font-display text-sm text-white tracking-wide">Send feedback</p>
            <p className="font-body text-xs text-faint mt-1">Tell us what you&apos;d like to see in the app.</p>
          </a>
        </div>

        {/* Follow SkateHubba — official accounts + Shopify store */}
        <SectionHeader title="FOLLOW SKATEHUBBA" />
        <FollowLinks />

        {/* Tutorial replay — re-arms Hesher's onboarding tour */}
        <SectionHeader title="TUTORIAL" />
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleReplayTutorial}
            disabled={replayingTutorial}
            className="block w-full text-left p-4 rounded-2xl glass-card hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <p className="font-display text-sm text-white tracking-wide">Replay onboarding</p>
            <p className="font-body text-xs text-faint mt-1">Run Hesher&apos;s welcome tour again from the top.</p>
          </button>
        </div>
        <TipsSettings />

        {isClosetStudioEnabled() && <SectionHeader title="CLOSET STUDIO" />}
        {isClosetStudioEnabled() && (
          <Link
            to="/closet/studio"
            className="mb-2 block p-4 rounded-2xl glass-card hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <p className="font-display text-sm text-white tracking-wide">Closet Studio</p>
            <p className="font-body text-xs text-faint mt-1">
              Design your own gear, starting from Mike White&apos;s templates.
            </p>
          </Link>
        )}

        <SectionHeader title="REPORTS & ACTIONS" />
        <SafetyReportsSection uid={profile.uid} />

        {/* Legal */}
        <SectionHeader title="LEGAL" />
        <div className="space-y-2">
          <Link
            to="/privacy"
            className="block p-4 rounded-2xl glass-card hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <p className="font-display text-sm text-white tracking-wide">Privacy Policy</p>
          </Link>
          <Link
            to="/terms"
            className="block p-4 rounded-2xl glass-card hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <p className="font-display text-sm text-white tracking-wide">Terms of Service</p>
          </Link>
          <Link
            to="/data-deletion"
            className="block p-4 rounded-2xl glass-card hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <p className="font-display text-sm text-white tracking-wide">Data Deletion</p>
          </Link>
        </div>

        <SectionHeader title="CREDITS" />
        <AppCredits />

        {/* Account — data export + deletion. Rows self-hide when the
            corresponding handler isn't supplied. */}
        {(onDownloadData || onDeleteAccount) && (
          <>
            <SectionHeader title="ACCOUNT" />
            <AccountActions onDownloadData={onDownloadData} onDeleteAccount={onDeleteAccount} />
          </>
        )}

        {/* Brand watermark */}
        <div className="brand-watermark mt-10">
          <div className="brand-divider flex-1 max-w-16" />
          <img src="/logonew.webp" alt="" draggable={false} className="h-4 w-auto select-none" aria-hidden="true" />
          <div className="brand-divider flex-1 max-w-16" />
        </div>
      </div>

      {avatarPickerOpen && (
        <AvatarPicker
          uid={profile.uid}
          onUploaded={() => setAvatarPickerOpen(false)}
          onClose={() => setAvatarPickerOpen(false)}
        />
      )}
    </div>
  );
}
