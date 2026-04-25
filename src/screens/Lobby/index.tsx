import type { UserProfile } from "../../services/users";
import type { GameDoc } from "../../services/games";
import { DeleteAccountModal } from "../../components/DeleteAccountModal";
import { VerifyEmailBanner } from "../../components/VerifyEmailBanner";
import { PushPermissionBanner } from "../../components/PushPermissionBanner";
import { PullToRefreshIndicator } from "../../components/PullToRefreshIndicator";
import { ClipsFeed } from "../../components/ClipsFeed";
import { useLobbyController } from "./useLobbyController";
import { LobbyHeader } from "./components/LobbyHeader";
import { ChallengeCTA } from "./components/ChallengeCTA";
import { ActiveGamesSection } from "./components/ActiveGamesSection";
import { CompletedGamesSection } from "./components/CompletedGamesSection";
import { LoadMoreButton } from "./components/LoadMoreButton";
import { EmptyLobbyState } from "./components/EmptyLobbyState";
import { PlayerDirectory } from "./components/PlayerDirectory";
import { AccountActionsFooter } from "./components/AccountActionsFooter";

interface Props {
  profile: UserProfile;
  games: GameDoc[];
  onChallenge: () => void;
  onChallengeUser: (username: string) => void;
  onOpenGame: (g: GameDoc) => void;
  onSignOut: () => void;
  onDeleteAccount: () => Promise<void>;
  onDownloadData?: () => Promise<void>;
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
  onChallengeUser,
  onOpenGame,
  onSignOut,
  onDeleteAccount,
  onDownloadData,
  onViewRecord,
  onOpenSettings,
  user,
  hasMoreGames = false,
  onLoadMore,
  gamesLoading = false,
  onViewPlayer,
}: Props) {
  const c = useLobbyController({ profile, games, onDownloadData });
  const emailVerified = user?.emailVerified ?? false;

  return (
    <div className="relative min-h-dvh bg-background/40 pb-24" {...c.ptr.containerProps}>
      <PullToRefreshIndicator offset={c.ptr.offset} state={c.ptr.state} triggerReached={c.ptr.triggerReached} />

      <LobbyHeader
        profile={profile}
        games={games}
        onViewRecord={onViewRecord}
        onOpenGame={onOpenGame}
        onOpenSettings={onOpenSettings}
        onSignOut={onSignOut}
      />

      <div className="max-w-2xl mx-auto">
        <VerifyEmailBanner emailVerified={emailVerified} />
        <PushPermissionBanner uid={profile.uid} />
      </div>

      <div className="px-5 pt-7 max-w-lg mx-auto">
        <ClipsFeed profile={profile} onViewPlayer={onViewPlayer ?? (() => {})} onChallengeUser={onChallengeUser} />

        <div className="mb-7">
          <h1 className="font-display text-fluid-4xl leading-none text-white tracking-wide">Your Games</h1>
          {games.length > 0 && (
            <p className="font-body text-xs text-brand-green mt-1.5">
              {c.liveActive.length > 0 ? `${c.liveActive.length} active` : "No active games"}
              {c.done.length > 0 ? ` · ${c.done.length} completed` : ""}
            </p>
          )}
        </div>

        <ChallengeCTA
          emailVerified={emailVerified}
          username={profile.username}
          onChallenge={onChallenge}
          onChallengeUser={onChallengeUser}
        />

        <ActiveGamesSection
          active={c.active}
          liveActiveCount={c.liveActive.length}
          showEmptyWhenNoActive={c.showActiveEmpty}
          isJudge={c.isJudge}
          isPlayer={c.isPlayer}
          isMyTurn={c.isMyTurn}
          opponent={c.opponent}
          opponentUid={c.opponentUid}
          opponentIsVerifiedPro={c.opponentIsVerifiedPro}
          myLetters={c.myLetters}
          theirLetters={c.theirLetters}
          turnLabel={c.turnLabel}
          cardButtonProps={c.cardButtonProps}
          onOpenGame={onOpenGame}
          onViewPlayer={onViewPlayer}
        />

        <CompletedGamesSection
          viewerUid={profile.uid}
          done={c.done}
          showEmptyWhenNoDone={c.showCompletedEmpty}
          isJudge={c.isJudge}
          isPlayer={c.isPlayer}
          opponent={c.opponent}
          opponentUid={c.opponentUid}
          opponentIsVerifiedPro={c.opponentIsVerifiedPro}
          cardButtonProps={c.cardButtonProps}
          onOpenGame={onOpenGame}
          onViewPlayer={onViewPlayer}
        />

        {hasMoreGames && games.length > 0 && <LoadMoreButton loading={gamesLoading} onClick={() => onLoadMore?.()} />}

        {games.length === 0 && <EmptyLobbyState emailVerified={emailVerified} onChallenge={onChallenge} />}

        <PlayerDirectory
          players={c.players}
          loading={c.playersLoading}
          user={user}
          onViewPlayer={onViewPlayer}
          onChallengeUser={onChallengeUser}
        />

        <AccountActionsFooter
          onDownloadData={onDownloadData}
          downloadingData={c.downloadingData}
          downloadError={c.downloadError}
          handleDownload={c.handleDownload}
          openDeleteModal={c.openDeleteModal}
        />
      </div>

      {c.showDeleteModal && <DeleteAccountModal onClose={c.closeDeleteModal} onDeleteAccount={onDeleteAccount} />}
    </div>
  );
}
