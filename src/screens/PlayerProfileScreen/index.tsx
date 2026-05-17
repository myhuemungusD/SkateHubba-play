import { useCallback, useEffect, useRef, useState } from "react";
import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";
import { analytics, trackEvent } from "../../services/analytics";
import type { StatTileName } from "./components/ProfileStatsGrid";
import { usePullToRefresh } from "../../hooks/usePullToRefresh";
import { PullToRefreshIndicator } from "../../components/PullToRefreshIndicator";
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
import { AchievementsRibbon } from "./components/AchievementsRibbon";
import { AddedSpotsPlaceholder } from "./components/AddedSpotsPlaceholder";

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
 *
 * Modern profile UX:
 *   - 96px avatar with optional custom image + pencil-edit overlay (own profile).
 *   - Pull-to-refresh on own profile.
 *   - "Share my profile" button on own profile (`navigator.share` with
 *     clipboard fallback). Shares a deep-link to `/profile/{uid}`.
 *   - AchievementsRibbon + AddedSpotsPlaceholder placeholders for layout
 *     fidelity; future PRs wire them to real data.
 *
 * Deferred until their respective counters ship on main:
 *   - Win-streak badge (needs currentWinStreak)
 *   - XP / level (currently placeholder L1 via LevelChip)
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

  // ── profile_viewed telemetry ──
  // Fires once per mount. `msToFirstPaint` is the elapsed time between
  // the first render commit and the first effect firing — a reasonable
  // proxy for First Contentful Paint without setting up a
  // PerformanceObserver. The baseline timestamp is captured inside the
  // effect on first run (not in a useRef initialiser, which the
  // react-hooks/purity rule rejects for impure clocks like
  // performance.now()) so `mountStartRef.current` stays null until the
  // effect commits and React strict-mode double-invocation doesn't
  // reset it.
  const mountStartRef = useRef<number | null>(null);
  const profileViewedFiredRef = useRef<boolean>(false);
  useEffect(() => {
    if (profileViewedFiredRef.current) return;
    if (mountStartRef.current === null) mountStartRef.current = performance.now();
    profileViewedFiredRef.current = true;
    const msToFirstPaint = Math.round(performance.now() - mountStartRef.current);
    analytics.profileViewed(currentUserProfile.uid, viewedUid, currentUserProfile.uid === viewedUid, msToFirstPaint);
  }, [currentUserProfile.uid, viewedUid]);

  // ── profile_stat_tile_tapped telemetry ──
  // Engagement signal fires on every tile tap. The `profileUid` is whose
  // profile is being viewed — pairs with `viewerUid` from `profile_viewed`
  // so the funnel can compute tile-tap-rate per profile-view session.
  const handleTileTap = useCallback(
    (statName: StatTileName) => {
      analytics.profileStatTileTapped(statName, viewedUid);
    },
    [viewedUid],
  );

  // PTR-no-op for own profile — refreshing the local profile snapshot is
  // a no-op at this layer because the snapshot is owned by GameContext.
  // Kept as `async () => undefined` so the gesture visually resolves
  // without a reload loop.
  const ptr = usePullToRefresh(async () => undefined);

  const [shareCopiedAt, setShareCopiedAt] = useState<number | null>(null);
  const handleShareProfile = useCallback(async () => {
    const url = `${window.location.origin}/profile/${currentUserProfile.uid}`;
    trackEvent("profile_share_my_profile_tapped", { uid: currentUserProfile.uid });
    const payload: ShareData = {
      title: `@${currentUserProfile.username} on SkateHubba`,
      text: `Catch my SkateHubba profile`,
      url,
    };
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (typeof nav.share === "function") {
      try {
        await nav.share(payload);
        return;
      } catch {
        // User cancelled or platform rejected — fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard?.writeText?.(url);
      setShareCopiedAt(Date.now());
      window.setTimeout(() => setShareCopiedAt(null), 1500);
    } catch {
      // No clipboard either — silent fail. Telemetry already fired so we
      // can detect this on the dashboard.
    }
  }, [currentUserProfile.uid, currentUserProfile.username]);

  if (c.loading) {
    return <ProfileSkeleton onBack={onBack} />;
  }

  if (c.error || !c.profile) {
    return <PlayerProfileError message={c.error ?? "Player not found"} onBack={onBack} />;
  }

  const profile = c.profile;
  const ptrBindings = isOwnProfile ? ptr.containerProps : undefined;

  return (
    <div className="min-h-dvh pb-24 overflow-y-auto bg-profile-glow" {...ptrBindings}>
      {isOwnProfile && (
        <PullToRefreshIndicator offset={ptr.offset} state={ptr.state} triggerReached={ptr.triggerReached} />
      )}
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

        {isOwnProfile && (
          <button
            type="button"
            onClick={handleShareProfile}
            data-testid="share-my-profile-button"
            className="w-full mb-6 px-4 py-2.5 rounded-full border border-brand-orange/40 bg-brand-orange/[0.08] font-display text-sm tracking-wider text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            aria-label="Share my profile"
          >
            {shareCopiedAt ? "LINK COPIED" : "SHARE MY PROFILE"}
          </button>
        )}

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

        <ProfileStatsGrid
          stats={c.stats}
          isOwnProfile={isOwnProfile}
          hasCompletedGames={c.completedGames.length > 0}
          onTileTap={handleTileTap}
        />

        <AchievementsRibbon />

        {isOwnProfile && <AddedSpotsPlaceholder />}

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
