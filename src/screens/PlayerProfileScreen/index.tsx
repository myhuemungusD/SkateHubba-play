import { useCallback, useEffect, useRef, useState } from "react";
import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";
import { analytics, trackEvent } from "../../services/analytics";
import { hashUid } from "../../utils/pii";
import type { StatTileName } from "./components/ProfileStatsGrid";
import { usePullToRefresh } from "../../hooks/usePullToRefresh";
import { PullToRefreshIndicator } from "../../components/PullToRefreshIndicator";
import { BadgesRow } from "../../components/BadgesRow";
import { ClosetShowcase } from "../../components/ClosetShowcase";
import { ProfileShowcase } from "../../components/ProfileShowcase";
import { usePlayerProfileController } from "./usePlayerProfileController";
import { BlockControls } from "./components/BlockControls";
import { ReportPlayerButton } from "./components/ReportPlayerButton";
import { ChallengeButton } from "./components/ChallengeButton";
import { RollDiceButton } from "./components/RollDiceButton";
import {
  isClipEditorEnabled,
  isClosetEnabled,
  isDiceEnabled,
  isExtrasEnabled,
  isMapCheckinsEnabled,
  isProBlessingEnabled,
  isProCommunityEnabled,
  isProfileBannerEnabled,
  isProfileCustomEnabled,
  isXpEnabled,
} from "../../lib/featureFlags";
import { BlessProButton } from "../../components/pro/BlessProButton";
import { BlessedByLine } from "../../components/pro/BlessedByLine";
import { AchievementsRibbon } from "./components/AchievementsRibbon";
import { GameHistorySection } from "./components/GameHistorySection";
import { OpponentList } from "./components/OpponentList";
import { PlayerProfileError } from "./components/PlayerProfileError";
import { ProfileHeader } from "./components/ProfileHeader";
import { ProfileIdentityCard } from "./components/ProfileIdentityCard";
import { ProfileBanner } from "./components/ProfileBanner";
import { ProfileSkeleton } from "./components/ProfileSkeleton";
import { ProfileStatsGrid } from "./components/ProfileStatsGrid";
import { SignUpToChallengeCta } from "./components/SignUpToChallengeCta";
import { AddedSpotsSection } from "./components/AddedSpotsSection";
import { WinStreakBanner } from "./components/WinStreakBanner";
import { ProShowcaseGate } from "./components/ProShowcaseGate";
import { PropsRow } from "../../components/pro/ProPicks";
import { OwnProfileActions } from "./components/OwnProfileActions";
import { useShareProfile } from "./useShareProfile";
import { useProfileCustom } from "./components/custom/useProfileCustom";
import { ProfileAbout } from "./components/custom/ProfileAbout";
import { PinnedClips } from "./components/custom/PinnedClips";
import { SignatureShowcase } from "./components/custom/SignatureShowcase";
import { ProfileCustomizeSheet } from "./components/custom/ProfileCustomizeSheet";
import { gradientCss, type SectionId } from "../../services/profileCustom";
import { SpotPassport } from "../../components/SpotPassport";

/**
 * Streak length before the banner appears. A "1 win streak" is just a win —
 * the banner should mark a run worth bragging about, not fire after every game.
 */
const MIN_DISPLAYED_WIN_STREAK = 2;

interface Props {
  viewedUid: string;
  /**
   * The signed-in viewer, or absent for a logged-out visitor arriving on a
   * shared `/player/:uid` link. Everything that needs a viewer identity
   * (challenge, block, game history, own-profile affordances) is withheld
   * when this is absent — see the docstring below.
   */
  currentUserProfile?: UserProfile | null;
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
   * CTA renders disabled rather than dead — see AddedSpotsSection.
   */
  onAddSpot?: () => void;
  /**
   * Refetches the signed-in user's profile, backing pull-to-refresh on the
   * own-profile view. Omit and the gesture still resolves, just without a
   * refetch (the pre-wiring behaviour).
   */
  onRefreshProfile?: () => Promise<void>;
  /**
   * Sends a signed-out visitor to the sign-up flow. Rendered in place of the
   * Challenge button, which cannot work without an account. Omit and the
   * public profile simply has no CTA.
   */
  onSignUp?: () => void;
  /**
   * Opens the profile-editing surface (Settings) from the own-profile header.
   * Omit and the Edit Profile button is not rendered at all — an inert button
   * next to Share would be worse than no button.
   */
  onEditProfile?: () => void;
  /**
   * Opens the owner-only My Stats screen. Own-profile only, and omitted the
   * same way `onEditProfile` is — an unwired caller renders no entry point
   * rather than a button that leads nowhere.
   */
  onViewMyStats?: () => void;
  /** Opens the pro-only Pro tools screen. Shown on a verified pro's own profile. */
  onOpenProTools?: () => void;
  /** Opens the full Closet screen from the Closet row's "See all". Omit and the row has no link. */
  onOpenCloset?: () => void;
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
 *   - "Share my profile" button on own profile (native share sheet via
 *     nativeBridge, clipboard fallback). Shares a deep-link to `/player/{uid}`.
 *   - AddedSpotsSection — spots this player created (`spots.createdBy`),
 *     each linking to `/spots/:id`. Empty state when they have added none.
 *     The CTA opens the map with the Add Spot sheet already open.
 *
 *   - BadgesRow / LockerShowcase — Economy Phase A. Real granted data, fetched
 *     by the controller; each renders nothing when the player has earned
 *     nothing (LockerShowcase shows one hint card on your own profile).
 *
 * The level chip, XP bar, and achievements ribbon render only when
 * VITE_FEATURE_XP_ENABLED is the literal "true". Off, the profile looks as
 * it does today. BadgesRow stays mounted either way.
 *
 * Signed-out visitors (`currentUserProfile` absent) reach this screen through
 * a shared `/player/:uid` link. They get the public doc's content — avatar,
 * username, stance, verified-pro badge, stat tiles — plus a sign-up CTA in
 * place of Challenge. Withheld: block controls, Challenge, and every
 * own-profile affordance (share-my-profile, pull-to-refresh, added spots).
 * Game history is withheld too, because Firestore gates game reads on
 * participation — an anonymous visitor can read none of them, and an empty
 * "no games yet" state would misreport a player who has played plenty.
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
  onSignUp,
  onEditProfile,
  onViewMyStats,
  onOpenProTools,
  onOpenCloset,
}: Props) {
  const c = usePlayerProfileController({
    viewedUid,
    currentUserProfile,
    ownGames,
    isOwnProfile,
    blockedUids,
  });

  // Absent viewer is carried as an empty uid — the same "no identity"
  // convention `useBlockedUsers("")` and `usePlayerProfile("")` already use.
  // `hashUid("")` passes it straight through, so the telemetry below reports
  // an anonymous view without inventing a uid (and, as everywhere else, a
  // raw Firebase uid never leaves the app).
  const customOn = isProfileCustomEnabled();
  const pc = useProfileCustom(viewedUid, customOn);
  const [customizing, setCustomizing] = useState(false);
  const viewerUid = currentUserProfile?.uid ?? "";
  const hasViewer = currentUserProfile != null;

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
    analytics.profileViewed(viewerUid, viewedUid, viewerUid === viewedUid, msToFirstPaint);
  }, [viewerUid, viewedUid]);

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
  // needs to sit disabled. The list above it is the player's own `spots`
  // docs; the button still opens the map with the Add Spot sheet ready.
  const handleAddSpot = useCallback(() => {
    if (!onAddSpot) return;
    trackEvent("profile_add_a_spot_tapped", { uid: hashUid(viewerUid) });
    onAddSpot();
  }, [onAddSpot, viewerUid]);

  const { share: handleShareProfile, copied: shareCopied } = useShareProfile(viewerUid, currentUserProfile?.username);

  // A visitor with no account has no lobby to go back to — send them home.
  const backLabel = hasViewer ? "Lobby" : "Home";

  if (c.loading) {
    return <ProfileSkeleton onBack={onBack} backLabel={backLabel} />;
  }

  if (c.error || !c.profile) {
    return <PlayerProfileError message={c.error ?? "Player not found"} onBack={onBack} backLabel={backLabel} />;
  }

  const profile = c.profile;
  const ptrBindings = isOwnProfile ? ptr.containerProps : undefined;

  return (
    <div
      className="min-h-dvh pb-24 overflow-y-auto bg-profile-glow"
      style={customOn ? { backgroundImage: gradientCss(pc.custom) } : undefined}
      data-testid="player-profile-root"
      {...ptrBindings}
    >
      {isOwnProfile && (
        <PullToRefreshIndicator offset={ptr.offset} state={ptr.state} triggerReached={ptr.triggerReached} />
      )}
      <ProfileHeader onBack={onBack} backLabel={backLabel} />

      <div className="px-5 pt-7 max-w-[430px] mx-auto">
        {isProfileBannerEnabled() && (
          <ProfileBanner
            uid={profile.uid}
            bannerImageUrl={profile.bannerImageUrl}
            isOwnProfile={isOwnProfile}
            crop={
              customOn ? { x: pc.custom.bannerPosX, y: pc.custom.bannerPosY, zoom: pc.custom.bannerZoom } : undefined
            }
          />
        )}
        <ProfileIdentityCard
          username={profile.username}
          isVerifiedPro={profile.isVerifiedPro}
          stance={profile.stance}
          profileImageUrl={profile.profileImageUrl}
          isOwnProfile={isOwnProfile}
          uid={profile.uid}
          xp={profile.xp}
        />

        {customOn && <ProfileAbout custom={pc.custom} stance={profile.stance} />}

        {isProBlessingEnabled() && profile.isVerifiedPro === true && (
          <BlessedByLine uid={profile.uid} onViewPlayer={onViewPlayer} />
        )}

        {isProCommunityEnabled() && <PropsRow uid={profile.uid} />}

        <ProShowcaseGate
          username={profile.username}
          stance={profile.stance ?? ""}
          bio={profile.proBio}
          signatureTricks={profile.proSignatureTricks}
          tagline={profile.proTagline}
          hometown={profile.proHometown}
          sponsors={profile.proSponsors}
          canEdit={isOwnProfile && profile.isVerifiedPro === true}
          wins={profile.wins ?? 0}
          losses={profile.losses ?? 0}
          viewerUid={viewerUid}
          uid={profile.uid}
          isOwn={isOwnProfile}
          onPlayPro={!isOwnProfile && hasViewer && !c.isBlocked ? onChallenge : undefined}
          onOpenProTools={isOwnProfile && profile.isVerifiedPro ? onOpenProTools : undefined}
        />

        {isOwnProfile && (
          <OwnProfileActions
            onEditProfile={onEditProfile}
            onViewMyStats={onViewMyStats}
            onShare={() => void handleShareProfile()}
            shareCopied={shareCopied}
            onCustomize={customOn ? () => setCustomizing(true) : undefined}
          />
        )}

        {/* Challenging and blocking both need an account. A signed-out visitor
            gets the sign-up CTA instead — otherwise the shared link dead-ends
            on a profile they can do nothing with. */}
        {!isOwnProfile && hasViewer && onChallenge && !c.isBlocked && (
          <ChallengeButton username={profile.username} uid={profile.uid} onChallenge={onChallenge} />
        )}

        {/* Pro is never earned: only a verified pro can bless another skater. */}
        {isProBlessingEnabled() &&
          !isOwnProfile &&
          currentUserProfile?.isVerifiedPro === true &&
          profile.isVerifiedPro !== true &&
          !c.isBlocked && <BlessProButton targetUid={profile.uid} username={profile.username} />}

        {isDiceEnabled() && !isOwnProfile && hasViewer && !c.isBlocked && (
          <RollDiceButton opponentUid={profile.uid} opponentUsername={profile.username} />
        )}

        {!hasViewer && onSignUp && <SignUpToChallengeCta username={profile.username} onSignUp={onSignUp} />}

        {!isOwnProfile && hasViewer && (
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
        {!isOwnProfile && hasViewer && (
          <ReportPlayerButton reporterUid={viewerUid} reportedUid={profile.uid} username={profile.username} />
        )}

        {c.stats.currentWinStreak >= MIN_DISPLAYED_WIN_STREAK && (
          <WinStreakBanner currentStreak={c.stats.currentWinStreak} />
        )}

        <BadgesRow achievements={c.achievements} />

        {isMapCheckinsEnabled() && hasViewer && <SpotPassport uid={profile.uid} isOwner={isOwnProfile} />}

        {customOn ? (
          <>
            {isXpEnabled() && <AchievementsRibbon achievements={c.achievements} clipsPosted={profile.clipsPosted} />}
            {pc.custom.sections.map((id: SectionId) => (
              <div key={id} data-testid={`custom-section-${id}`}>
                {id === "clips" && (
                  <PinnedClips
                    clips={pc.pinned}
                    editor={
                      isOwnProfile && isClipEditorEnabled()
                        ? { uid: profile.uid, username: profile.username }
                        : undefined
                    }
                  />
                )}
                {id === "stats" && (
                  <ProfileStatsGrid
                    stats={c.stats}
                    isOwnProfile={isOwnProfile}
                    hasCompletedGames={hasViewer && c.completedGames.length > 0}
                    onTileTap={handleTileTap}
                  />
                )}
                {id === "closet" && isClosetEnabled() && (
                  <>
                    {pc.custom.showcaseSignature && (
                      <SignatureShowcase items={c.lockerItems} accent={pc.custom.accent} />
                    )}
                    <ProfileShowcase
                      equippedItems={c.equippedItems}
                      pinnedItems={c.pinnedItems}
                      isOwnProfile={isOwnProfile}
                    />
                    <ClosetShowcase items={c.lockerItems} isOwnProfile={isOwnProfile} onSeeAll={onOpenCloset} />
                  </>
                )}
                {id === "crew" && hasViewer && (
                  <OpponentList
                    opponents={c.opponents}
                    currentUserUid={viewerUid}
                    isOwnProfile={isOwnProfile}
                    onViewPlayer={onViewPlayer}
                  />
                )}
                {id === "spots" && isOwnProfile && isExtrasEnabled() && (
                  <AddedSpotsSection uid={viewedUid} onAddSpot={onAddSpot ? handleAddSpot : undefined} />
                )}
              </div>
            ))}
          </>
        ) : (
          <>
            {isClosetEnabled() && (
              <ProfileShowcase
                equippedItems={c.equippedItems}
                pinnedItems={c.pinnedItems}
                isOwnProfile={isOwnProfile}
              />
            )}

            {isXpEnabled() && <AchievementsRibbon achievements={c.achievements} clipsPosted={profile.clipsPosted} />}

            {/* The VS-YOU row this flag unlocks is head-to-head against the
              viewer. With no viewer there is no such record to report. */}
            <ProfileStatsGrid
              stats={c.stats}
              isOwnProfile={isOwnProfile}
              hasCompletedGames={hasViewer && c.completedGames.length > 0}
              onTileTap={handleTileTap}
            />

            {isClosetEnabled() && (
              <ClosetShowcase items={c.lockerItems} isOwnProfile={isOwnProfile} onSeeAll={onOpenCloset} />
            )}

            {/* Owner-only: advertising an unbuilt feature on someone else's public
              profile is noise to every visitor but the owner. */}
            {isOwnProfile && isExtrasEnabled() && (
              <AddedSpotsSection uid={viewedUid} onAddSpot={onAddSpot ? handleAddSpot : undefined} />
            )}
          </>
        )}

        {/* Both sections are derived from games, and game reads are gated on
            participation — a signed-out visitor can read none of them. The
            history section in particular would render "No games between you
            two yet" to someone who has no "you two": a false statement about
            the player's record. Omit both rather than under-report. */}
        {hasViewer && (
          <>
            {!customOn && (
              <OpponentList
                opponents={c.opponents}
                currentUserUid={viewerUid}
                isOwnProfile={isOwnProfile}
                onViewPlayer={onViewPlayer}
              />
            )}

            <GameHistorySection
              isOwnProfile={isOwnProfile}
              profileUsername={profile.username}
              profileUid={profile.uid}
              completedGames={c.completedGames}
              expandedGameId={c.expandedGameId}
              toggleExpanded={c.toggleExpanded}
              onOpenGame={onOpenGame}
            />
          </>
        )}
      </div>
      {customizing && (
        <ProfileCustomizeSheet
          uid={profile.uid}
          initial={pc.custom}
          onClose={() => setCustomizing(false)}
          onSaved={(next) => void pc.applySaved(next)}
        />
      )}
    </div>
  );
}
