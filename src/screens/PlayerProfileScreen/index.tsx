import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";
import { Btn } from "../../components/ui/Btn";
import { FlameIcon, SkateboardIcon } from "../../components/icons";
import { ProUsername } from "../../components/ProUsername";
import { usePlayerProfileController } from "./usePlayerProfileController";
import { BlockControls } from "./components/BlockControls";
import { GameHistoryCard } from "./components/GameHistoryCard";
import { OpponentList } from "./components/OpponentList";
import { ProfileHeader } from "./components/ProfileHeader";
import { ProfileSkeleton } from "./components/ProfileSkeleton";
import { SectionHeader } from "./components/SectionHeader";
import { StatCard } from "./components/StatCard";

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
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center px-6 bg-background/80">
        <SkateboardIcon size={32} className="mb-4 text-faint" />
        <p className="font-body text-sm text-faint mb-4">{c.error ?? "Player not found"}</p>
        <Btn onClick={onBack} variant="ghost">
          Back to Lobby
        </Btn>
      </div>
    );
  }

  const profile = c.profile;

  return (
    <div className="min-h-dvh pb-24 overflow-y-auto bg-profile-glow">
      <ProfileHeader onBack={onBack} />

      <div className="px-5 pt-7 max-w-lg mx-auto">
        <div className="flex items-center gap-4 mb-8 animate-fade-in">
          <div className="w-14 h-14 rounded-full bg-brand-orange/[0.12] border-2 border-brand-orange/30 flex items-center justify-center shrink-0 shadow-glow-sm">
            <span className="font-display text-xl text-brand-orange leading-none">
              {profile.username[0].toUpperCase()}
            </span>
          </div>
          <div>
            <h1 className="font-display text-3xl text-white leading-none tracking-wide">
              <ProUsername username={profile.username} isVerifiedPro={profile.isVerifiedPro} />
            </h1>
            <p className="font-body text-xs text-muted mt-1.5 capitalize">{profile.stance}</p>
          </div>
        </div>

        {!isOwnProfile && onChallenge && !c.isBlocked && (
          <Btn onClick={() => onChallenge(profile.uid, profile.username)} className="w-full mb-4">
            Challenge @{profile.username}
          </Btn>
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

        <div className="grid grid-cols-3 gap-2.5 mb-2.5 animate-fade-in">
          <StatCard label="Wins" value={c.stats.wins} color="text-brand-green" />
          <StatCard label="Losses" value={c.stats.losses} color="text-brand-red" />
          <StatCard
            label="Win Rate"
            value={`${c.stats.winRate}%`}
            color={c.stats.winRate >= 50 ? "text-brand-orange" : "text-muted"}
          />
        </div>

        {isOwnProfile ? (
          <>
            <div className="grid grid-cols-3 gap-2.5 mb-2.5 animate-fade-in">
              <StatCard label="Games" value={c.stats.total} color="text-white" />
              <StatCard label="Best Streak" value={c.stats.longestStreak} color="text-brand-orange" />
              <StatCard
                label="Land Rate"
                value={`${c.stats.landRate}%`}
                color={c.stats.landRate >= 50 ? "text-brand-green" : "text-muted"}
              />
            </div>

            <div className="grid grid-cols-3 gap-2.5 mb-8 animate-fade-in">
              <StatCard label="Total Turns" value={c.stats.totalTricks} color="text-white" />
              <StatCard label="Landed" value={c.stats.tricksLanded} color="text-brand-green" />
              <StatCard label="Missed" value={c.stats.totalTricks - c.stats.tricksLanded} color="text-brand-red" />
            </div>
          </>
        ) : (
          <div className="mb-6" />
        )}

        {!isOwnProfile && c.completedGames.length > 0 && (
          <>
            <p className="font-display text-[10px] tracking-[0.2em] text-brand-orange mb-2.5 animate-fade-in">VS YOU</p>
            <div className="grid grid-cols-3 gap-2.5 mb-8 animate-fade-in">
              <StatCard label="Your Wins" value={c.stats.vsYouWins} color="text-brand-green" />
              <StatCard label="Your Losses" value={c.stats.vsYouLosses} color="text-brand-red" />
              <StatCard label="Games" value={c.stats.vsYouTotal} color="text-white" />
            </div>
          </>
        )}

        {isOwnProfile && c.stats.currentStreak >= 2 && (
          <div
            className="flex items-center justify-center gap-2.5 mb-8 px-4 py-3.5 rounded-xl border border-brand-orange/30 bg-brand-orange/[0.06] shadow-glow-sm animate-scale-in"
            role="status"
            aria-label={`${c.stats.currentStreak} game win streak`}
          >
            <FlameIcon size={18} className="text-brand-orange" />
            <span className="font-display text-sm tracking-wider text-brand-orange">
              {c.stats.currentStreak} WIN STREAK
            </span>
            <FlameIcon size={18} className="text-brand-orange" />
          </div>
        )}

        <OpponentList
          opponents={c.opponents}
          currentUserUid={currentUserProfile.uid}
          isOwnProfile={isOwnProfile}
          onViewPlayer={onViewPlayer}
        />

        <div className="mb-6 animate-fade-in">
          <SectionHeader title={isOwnProfile ? "GAME HISTORY" : "GAMES VS YOU"} count={c.completedGames.length} />

          {c.completedGames.length === 0 ? (
            <div className="flex flex-col items-center py-14 border border-dashed border-border rounded-2xl">
              <SkateboardIcon size={28} className="mb-3 opacity-30 text-subtle" />
              <p className="font-body text-sm text-faint">
                {isOwnProfile ? "No games played yet" : "No games between you two yet"}
              </p>
              <p className="font-body text-[11px] text-subtle mt-1">
                {isOwnProfile
                  ? "Challenge someone and finish a game to build your record"
                  : `Challenge @${profile.username} to start a rivalry`}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {c.completedGames.map((g) => (
                <GameHistoryCard
                  key={g.id}
                  game={g}
                  profileUid={profile.uid}
                  expanded={c.expandedGameId === g.id}
                  onToggle={c.toggleExpanded}
                  onOpenGame={onOpenGame}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
