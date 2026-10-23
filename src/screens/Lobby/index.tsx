import { lazy, Suspense, useMemo } from "react";
import type { UserProfile } from "../../services/users";
import {
  isDiceEnabled,
  isRandomChallengerEnabled,
  isRunnerEnabled,
  isSpotPresenceEnabled,
} from "../../lib/featureFlags";
import type { GameDoc } from "../../services/games";
import { PushPermissionBanner } from "../../components/PushPermissionBanner";
import { useLobbyController } from "./useLobbyController";
import { LobbyHeader } from "./components/LobbyHeader";
import { TurnStack } from "./components/TurnStack";
import { TheirTurnSection } from "./components/TheirTurnSection";
import { CompletedSummaryLine } from "./components/CompletedSummaryLine";
import { LoadMoreButton } from "./components/LoadMoreButton";
import { EmptyLobbyState } from "./components/EmptyLobbyState";
import { RunnerCard } from "./components/RunnerCard";
import { WhosSkatingButton } from "./components/WhosSkatingButton";
import { SkaterSearch } from "./components/SkaterSearch";
import { FindChallengerButton } from "./components/FindChallengerButton";
import { RecentlyPlayed } from "./components/RecentlyPlayed";
import { recentOpponents } from "./recentOpponents";

const RollDiceCard = lazy(() => import("./components/RollDiceCard").then((m) => ({ default: m.RollDiceCard })));

interface Props {
  profile: UserProfile;
  games: GameDoc[];
  onChallenge: () => void;
  onOpenGame: (g: GameDoc) => void;
  onOpenDice?: (gameId: string) => void;
  onSignOut: () => void;
  onViewRecord: () => void;
  onOpenSettings?: () => void;
  user: { emailVerified?: boolean } | null;
  hasMoreGames?: boolean;
  onLoadMore?: () => void;
  gamesLoading?: boolean;
  onViewPlayer?: (uid: string) => void;
  onOpenAppeal?: (path: string) => void;
  /** Opens the challenge form with this username filled in. Falls back to onChallenge. */
  onChallengeUser?: (username: string) => void;
  /** Starts a rematch from "Recently played". Unset while the viewer can't challenge. */
  onRematch?: (uid: string, username: string) => Promise<void>;
  blockedUids?: ReadonlySet<string>;
}

const NO_BLOCKS: ReadonlySet<string> = new Set();

export function Lobby({
  profile,
  games,
  onChallenge,
  onOpenGame,
  onOpenDice,
  onSignOut,
  onViewRecord,
  onOpenSettings,
  user,
  hasMoreGames = false,
  onLoadMore,
  gamesLoading = false,
  onViewPlayer,
  onOpenAppeal,
  onChallengeUser,
  onRematch,
  blockedUids = NO_BLOCKS,
}: Props) {
  const c = useLobbyController({ profile, games });
  const emailVerified = user?.emailVerified ?? false;
  const challengeUser = onChallengeUser ?? (() => onChallenge());
  const recent = useMemo(() => recentOpponents(games, profile.uid, blockedUids), [games, profile.uid, blockedUids]);
  const activeOpponents = useMemo(() => new Set(recent.filter((o) => o.activeGame).map((o) => o.uid)), [recent]);

  return (
    <div className="lobby-root relative min-h-dvh bg-background/40 pb-24">
      <LobbyHeader
        profile={profile}
        games={games}
        onViewRecord={onViewRecord}
        onOpenGame={onOpenGame}
        onOpenDice={onOpenDice}
        onOpenAppeal={onOpenAppeal}
        onOpenSettings={onOpenSettings}
        onSignOut={onSignOut}
      />

      <div className="max-w-[430px] mx-auto">
        <PushPermissionBanner uid={profile.uid} />
      </div>

      <div className="px-5 pt-7 max-w-[430px] mx-auto">
        {/* The redesign leads with the turn stack, so the screen name is
            screen-reader-only: it restores the h1 every other screen has and
            anchors the heading outline without bringing back the "Your Games"
            section header the redesign removed. */}
        <h1 className="sr-only">Your games</h1>

        {!emailVerified && <p className="mb-5 font-body text-xs text-muted">Verify your email to start challenging.</p>}

        {/* Home order: find a skater, (flagged) random challenger, your games,
            recently played, then Who's skating at the bottom. */}
        <SkaterSearch
          viewerUid={profile.uid}
          canChallenge={emailVerified}
          onChallengeUser={challengeUser}
          onViewPlayer={onViewPlayer}
        />
        {/* Flag off: hidden. There is no quickplay to route to yet. */}
        {isRandomChallengerEnabled() && (
          <FindChallengerButton
            viewerUid={profile.uid}
            excludeUids={activeOpponents}
            disabled={!emailVerified}
            onChallengeUser={challengeUser}
            onFallback={onChallenge}
          />
        )}
        <TurnStack games={c.myTurn} c={c} onOpenGame={onOpenGame} onViewPlayer={onViewPlayer} />

        <TheirTurnSection games={c.theirTurn} c={c} onOpenGame={onOpenGame} onViewPlayer={onViewPlayer} />

        <CompletedSummaryLine summary={c.completedSummary} onViewRecord={onViewRecord} />

        {hasMoreGames && games.length > 0 && <LoadMoreButton loading={gamesLoading} onClick={() => onLoadMore?.()} />}

        {/* No game in progress: always offer a clear way to start one. A
            skater with only finished games used to see a near-empty Home. */}
        {c.myTurn.length === 0 && c.theirTurn.length === 0 && (
          <EmptyLobbyState emailVerified={emailVerified} onChallenge={onChallenge} returning={games.length > 0} />
        )}

        <RecentlyPlayed
          opponents={recent}
          onRematch={emailVerified ? onRematch : undefined}
          onOpenGame={onOpenGame}
          onViewPlayer={onViewPlayer}
        />

        {isSpotPresenceEnabled() ? <WhosSkatingButton uid={profile.uid} /> : null}
        {isRunnerEnabled() ? <RunnerCard /> : null}
        {isDiceEnabled() ? (
          <Suspense fallback={null}>
            <RollDiceCard />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}
