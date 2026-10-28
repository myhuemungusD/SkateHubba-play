import { useCallback, useState } from "react";
import { AppCredits } from "../components/AppCredits";
import { isClosetStudioEnabled, isSms2faEnabled } from "../lib/featureFlags";
import { Link } from "react-router";
import type { UserProfile } from "../services/users";
import { unblockUser } from "../services/blocking";
import { useBlockedUsers } from "../hooks/useBlockedUsers";
import { isHapticsEnabled, setHapticsEnabled, playHaptic } from "../services/haptics";
import { useNotifications } from "../context/NotificationContext";
import { useInstallPrompt } from "../hooks/useInstallPrompt";
import { ScreenHeader } from "../components/ScreenHeader";
import { useOnboardingContext } from "../context/OnboardingContext";
import { AvatarPicker } from "../components/AvatarPicker";
import { InstallAppCard } from "../components/InstallAppCard";
import { AccountActions } from "../components/AccountActions";
import { TwoFactorSection } from "../components/TwoFactorSection";
import { SmsTwoFactorSection } from "../components/SmsTwoFactorSection";
import { FollowLinks } from "./settings/FollowLinks";
import { TrainingConsentToggle } from "../components/TrainingConsentToggle";
import { SafetyReportsSection } from "../components/SafetyReportsSection";
import { PrefRow, ROW_CLASS, RowBody, SectionHeader, SettingsGroup } from "./settings/SettingsPrimitives";
import { BlockedPlayersList } from "./settings/BlockedPlayersList";
import { PresenceSettings } from "./settings/PresenceSettings";
import { PushSettings } from "./settings/PushSettings";
import { TipsSettings } from "./settings/TipsSettings";
import type { DataDownloadOutcome } from "../services/userData";

const LEGAL_LINKS = [
  { to: "/privacy", title: "Privacy Policy" },
  { to: "/terms", title: "Terms of Service" },
  { to: "/data-deletion", title: "Data Deletion" },
];

/* ── Main Settings screen ───────────────────────────────── */

export function Settings({
  profile,
  onBack,
  onDownloadData,
  onDeleteAccount,
  onSignOut,
}: {
  profile: UserProfile;
  onBack: () => void;
  /** Data-export handler. Omit to hide the row (see {@link AccountActions}). */
  onDownloadData?: () => Promise<DataDownloadOutcome | void>;
  /** Account-deletion handler. Omit to hide the row. */
  onDeleteAccount?: () => Promise<void>;
  /** Sign-out handler. Omit to hide the row; the row asks before signing out. */
  onSignOut?: () => void | Promise<void>;
}) {
  const { soundEnabled, toggleSound } = useNotifications();
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
    <div className="min-h-dvh pb-tabbar overflow-y-auto bg-background/80">
      <div className="px-5 pt-safe pb-3 border-b border-white/[0.04] glass">
        <div className="max-w-[430px] mx-auto">
          <ScreenHeader title="Settings" fallback="/me" onBack={onBack} />
        </div>
      </div>

      <div className="px-5 pt-6 max-w-[430px] mx-auto">
        {/* Account + privacy first (iOS / Instagram settings order). */}
        <SectionHeader title="Account" />
        <SettingsGroup>
          <button type="button" onClick={() => setAvatarPickerOpen(true)} className={ROW_CLASS}>
            <RowBody
              title="Edit Avatar"
              sub="Replace your default avatar with a custom photo. Image is screened on-device before upload."
            />
          </button>
          <TwoFactorSection />
          {isSms2faEnabled() && <SmsTwoFactorSection />}
        </SettingsGroup>

        <SectionHeader title="Privacy" />
        <SettingsGroup>
          <TrainingConsentToggle uid={profile.uid} />
        </SettingsGroup>

        <PresenceSettings uid={profile.uid} />

        <SectionHeader title="Blocked players" count={blockedUids.size} />
        <SettingsGroup>
          <BlockedPlayersList currentUserUid={profile.uid} blockedUids={blockedUids} onUnblock={handleUnblock} />
        </SettingsGroup>

        <SectionHeader title="Reports & actions" />
        <SettingsGroup>
          <SafetyReportsSection uid={profile.uid} />
        </SettingsGroup>

        <SectionHeader title="Notifications" />
        <SettingsGroup>
          <PushSettings uid={profile.uid} />
        </SettingsGroup>

        <SectionHeader title="Sound & haptics" />
        <SettingsGroup>
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
        </SettingsGroup>

        {/* Install as an app (web only) */}
        {installStatus !== "native" && (
          <>
            <SectionHeader title="Install app" />
            <SettingsGroup>
              <InstallAppCard status={installStatus} onInstall={promptInstall} />
            </SettingsGroup>
          </>
        )}

        <SectionHeader title="Help & support" />
        <SettingsGroup>
          <a href={`mailto:${supportEmail}?subject=${bugSubject}`} className={ROW_CLASS}>
            <RowBody title="Report a bug" sub="Email our team — include a screenshot if you can." />
          </a>
          <a href={`mailto:${supportEmail}?subject=${feedbackSubject}`} className={ROW_CLASS}>
            <RowBody title="Send feedback" sub="Tell us what you'd like to see in the app." />
          </a>
        </SettingsGroup>

        {/* Follow SkateHubba — official accounts + Shopify store */}
        <SectionHeader title="Follow SkateHubba" />
        <FollowLinks />

        {/* Tutorial replay — re-arms Hesher's onboarding tour */}
        <SectionHeader title="Tutorial" />
        <SettingsGroup>
          <button type="button" onClick={handleReplayTutorial} disabled={replayingTutorial} className={ROW_CLASS}>
            <RowBody title="Replay onboarding" sub="Run Hesher's welcome tour again from the top." />
          </button>
          <TipsSettings />
        </SettingsGroup>

        {isClosetStudioEnabled() && (
          <>
            <SectionHeader title="Closet Studio" />
            <SettingsGroup>
              <Link to="/closet/studio" className={ROW_CLASS}>
                <RowBody title="Closet Studio" sub="Design your own gear, starting from Mike White's templates." />
              </Link>
            </SettingsGroup>
          </>
        )}

        <SectionHeader title="Legal" />
        <SettingsGroup>
          {LEGAL_LINKS.map((l) => (
            <Link key={l.to} to={l.to} className={ROW_CLASS}>
              <RowBody title={l.title} />
            </Link>
          ))}
        </SettingsGroup>

        <SectionHeader title="Credits" />
        <SettingsGroup>
          <AppCredits />
        </SettingsGroup>

        {/* Data export, sign out, deletion. Rows self-hide when the
            corresponding handler isn't supplied. */}
        {(onDownloadData || onDeleteAccount || onSignOut) && (
          <>
            <SectionHeader title="Your data & sign out" />
            <SettingsGroup>
              <AccountActions onDownloadData={onDownloadData} onDeleteAccount={onDeleteAccount} onSignOut={onSignOut} />
            </SettingsGroup>
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
