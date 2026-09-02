import type { UserProfile } from "../../services/users";
import type { GameDoc } from "../../services/games";
import { PushPermissionBanner } from "../../components/PushPermissionBanner";
import { useLobbyController } from "./useLobbyController";
import { LobbyHeader } from "./components/LobbyHeader";
import { TurnStack } from "./components/TurnStack";
import { TheirTurnSection } from "./components/TheirTurnSection";
import { CompletedSummaryLine } from "./components/CompletedSummaryLine";
import { LoadMoreButton } from "./components/LoadMoreButton";
import { EmptyLobbyState } from "./components/EmptyLobbyState";

interface Props {
  profile: UserProfile;
  games: GameDoc[];
  onChallenge: () => void;
  onOpenGame: (g: GameDoc) => void;
  onSignOut: () => void;
  onViewRecord: () => void;
  onOpenSettings?: () => void;
  user: { emailVerified?: boolean } | null;
  hasMoreGames?: boolean;
  onLoadMore?: () => void;
  gamesLoading?: boolean;
  onViewPlayer?: (uid: string) => void;
}

export function Lobby({
  profile,
  games,
  onChallenge,
  onOpenGame,
  onSignOut,
  onViewRecord,
  onOpenSettings,
  user,
  hasMoreGames = false,
  onLoadMore,
  gamesLoading = false,
  onViewPlayer,
}: Props) {
  const c = useLobbyController({ profile, games });
  const emailVerified = user?.emailVerified ?? false;

  return (
    <div className="relative min-h-dvh bg-background/40 pb-24">
      <LobbyHeader
        profile={profile}
        games={games}
        onViewRecord={onViewRecord}
        onOpenGame={onOpenGame}
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

        <TurnStack games={c.myTurn} c={c} onOpenGame={onOpenGame} onViewPlayer={onViewPlayer} />

        <TheirTurnSection games={c.theirTurn} c={c} onOpenGame={onOpenGame} onViewPlayer={onViewPlayer} />

        <CompletedSummaryLine summary={c.completedSummary} onViewRecord={onViewRecord} />

        {hasMoreGames && games.length > 0 && <LoadMoreButton loading={gamesLoading} onClick={() => onLoadMore?.()} />}

        {games.length === 0 && <EmptyLobbyState emailVerified={emailVerified} onChallenge={onChallenge} />}
      </div>
    </div>
  );
}
