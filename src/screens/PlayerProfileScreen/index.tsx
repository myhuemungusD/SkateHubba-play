import { useCallback, useEffect, useRef, useState } from "react";
import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";
import { analytics, trackEvent } from "../../services/analytics";
import { hashUid } from "../../utils/pii";
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
import { AddedSpotsPlaceholder } from "./components/AddedSpotsPlaceholder";
import { WinStreakBanner } from "./components/WinStreakBanner";

/**
 * Streak length before the banner appears. A "1 win streak" is just a win —
 * the banner should mark a run worth bragging about, not fire after every game.
 */
const MIN_DISPLAYED_WIN_STREAK = 2;

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
  /**
   * Called when the user taps "ADD A SPOT" on their own profile. Omit and the
   * CTA renders disabled rather than dead — see AddedSpotsPlaceholder.
   */
  onAddSpot?: () => void;
  /**
   * Refetches the signed-in user's profile, backing pull-to-refresh on the
   * own-profile view. Omit and the gesture still resolves, just without a
   * refetch (the pre-wiring behaviour).
   */
  onRefreshProfile?: () => Promise<void>;
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
 *     clipboard fallback). Shares a deep-link to `/player/{uid}`.
 *   - AddedSpotsPlaceholder — empty state whose CTA opens the map with the
 *     Add Spot sheet already open; the spot *list* still awaits real data.
 *
 * Deliberately NOT rendered until real data exists to back them. Rendering a
 * placeholder on a live profile reads as an unfinished product, so these stay
 * off the screen rather than shipping as visible stubs. Both components are
 * kept (with their tests) so re-enabling them is a one-line change:
 *   - AchievementsRibbon — 12 locked "???" tiles. There is no
 *     `users/{uid}/achievements` collection, so every tile is permanently
 *     locked. Re-render it once achievements are actually granted.
 *   - LevelChip (in ProfileIdentityCard) — hard-coded "L1"; `UserProfile` has
 *     no `level` field and there is no XP system. Re-add it with the XP work.
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
  onAddSpot,
  onRefreshProfile,
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

  // The own-profile snapshot comes from a ONE-TIME `getUserProfile` read at
  // auth time, not a live listener — so it goes stale, and this gesture used
  // to animate without refetching anything. That matters more now that
  // wins/losses are incremented server-side by applyGameStats after a game
  // ends: without a refetch the user has no way to see their own new record.
  // `onRefreshProfile` stays optional so an unwired caller keeps the old
  // resolve-immediately behaviour rather than crashing.
  const ptr = usePullToRefresh(async () => {
    await onRefreshProfile?.();
  });

  // The map/add-spot flow already exists at `/map`, so the CTA no longer
  // needs to sit disabled. The spot *list* above it still awaits the
  // spot-check-in PR's `spotsAddedCount` data, but the button now does the
  // thing its label promises instead of being an inert affordance.
  const handleAddSpot = useCallback(() => {
    if (!onAddSpot) return;
    trackEvent("profile_add_a_spot_tapped", { uid: hashUid(currentUserProfile.uid) });
    onAddSpot();
  }, [onAddSpot, currentUserProfile.uid]);

  const [shareCopiedAt, setShareCopiedAt] = useState<number | null>(null);
  const handleShareProfile = useCallback(async () => {
    // `/player/:uid` is the public profile route. `/profile` is the
    // profile-*setup* route and matches exactly, so `/profile/{uid}` fell
    // through to `*` and redirected every shared link to /404.
    const url = `${window.location.origin}/player/${currentUserProfile.uid}`;
    trackEvent("profile_share_my_profile_tapped", { uid: hashUid(currentUserProfile.uid) });
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

        {c.stats.currentWinStreak >= MIN_DISPLAYED_WIN_STREAK && (
          <WinStreakBanner currentStreak={c.stats.currentWinStreak} />
        )}

        <ProfileStatsGrid
          stats={c.stats}
          isOwnProfile={isOwnProfile}
          hasCompletedGames={c.completedGames.length > 0}
          onTileTap={handleTileTap}
        />

        {/* Owner-only: advertising an unbuilt feature on someone else's public
            profile is noise to every visitor but the owner. AchievementsRibbon
            used to sit here too — see this file's docstring for why it doesn't. */}
        {isOwnProfile && <AddedSpotsPlaceholder onAddSpot={onAddSpot ? handleAddSpot : undefined} />}

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
