import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";
import { usePlayerProfileController } from "./usePlayerProfileController";
import { BlockControls } from "./components/BlockControls";
import { ChallengeButton } from "./components/ChallengeButton";
import { GameHistorySection } from "./components/GameHistorySection";
import { OpponentList } from "./components/OpponentList";
import { PlayerProfileError } from "./components/PlayerProfileError";
import { ProfileHeader } from "./components/ProfileHeader";
import { ProfileIdentityCard } from "./components/ProfileIdentityCard";
import { ProfileSkeleton } from "./components/ProfileSkeleton";
import { ProfileStatsGrid } from "./components/ProfileStatsGrid";
import { WinStreakBanner } from "./components/WinStreakBanner";

interface Props {
  viewedUid: string;
  currentUserProfile: UserProfile;
  /** Games from GameContext — used when viewing own profile to avoid redundant fetch. */
  ownGames: GameDoc[];
  isOwnProfile: boolean;
  onOpenGame: (g: GameDoc) => void;
  onBack: () => void;
  /** Called when the user taps "Challenge" on another player's profile. */
  onChallenge?: (uid: string, username: string) => void;
  /** Called when the user taps an opponent in the H2H list. */
  onViewPlayer?: (uid: string) => void;
  /** Set of UIDs the current user has blocked (for block/unblock UI). */
  blockedUids?: Set<string>;
}

/**
 * Public player profile screen. Shows any player's record, stats, and game history.
 *
 * When `isOwnProfile` is true, uses the provided `ownGames` prop (from GameContext)
 * to avoid a redundant fetch. When viewing another player, fetches their data via
 * the `usePlayerProfile` hook.
 */
export function PlayerProfileScreen({
  viewedUid,
  currentUserProfile,
  ownGames,
  isOwnProfile,
  onOpenGame,
  onBack,
  onChallenge,
  onViewPlayer,
  blockedUids,
}: Props) {
  const c = usePlayerProfileController({
    viewedUid,
    currentUserProfile,
    ownGames,
    isOwnProfile,
    blockedUids,
  });

  if (c.loading) {
    return <ProfileSkeleton onBack={onBack} />;
  }

  if (c.error || !c.profile) {
    return <PlayerProfileError message={c.error ?? "Player not found"} onBack={onBack} />;
  }

  const profile = c.profile;

  return (
    <div className="min-h-dvh pb-24 overflow-y-auto bg-profile-glow">
      <ProfileHeader onBack={onBack} />

      <div className="px-5 pt-7 max-w-lg mx-auto">
        <ProfileIdentityCard
          username={profile.username}
          isVerifiedPro={profile.isVerifiedPro}
          stance={profile.stance}
          profileImageUrl={profile.profileImageUrl}
          isOwnProfile={isOwnProfile}
          uid={profile.uid}
        />

        {!isOwnProfile && onChallenge && !c.isBlocked && (
          <ChallengeButton username={profile.username} uid={profile.uid} onChallenge={onChallenge} />
        )}

        {!isOwnProfile && (
          <BlockControls
            username={profile.username}
            isBlocked={c.isBlocked}
            blockLoading={c.blockLoading}
            showBlockConfirm={c.showBlockConfirm}
            onOpenBlockConfirm={c.openBlockConfirm}
            onCancelBlockConfirm={c.cancelBlockConfirm}
            onConfirmBlock={c.confirmBlock}
            onUnblock={c.handleUnblock}
          />
        )}

        <ProfileStatsGrid stats={c.stats} isOwnProfile={isOwnProfile} hasCompletedGames={c.completedGames.length > 0} />

        {isOwnProfile && c.stats.currentStreak >= 2 && <WinStreakBanner currentStreak={c.stats.currentStreak} />}

        <OpponentList
          opponents={c.opponents}
          currentUserUid={currentUserProfile.uid}
          isOwnProfile={isOwnProfile}
          onViewPlayer={onViewPlayer}
        />

        <GameHistorySection
          isOwnProfile={isOwnProfile}
          profileUsername={profile.username}
          profileUid={profile.uid}
          completedGames={c.completedGames}
          expandedGameId={c.expandedGameId}
          toggleExpanded={c.toggleExpanded}
          onOpenGame={onOpenGame}
        />
      </div>
    </div>
  );
}
