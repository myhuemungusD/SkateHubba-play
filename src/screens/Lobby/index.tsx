import type { UserProfile } from "../../services/users";
import type { GameDoc } from "../../services/games";
import { InviteButton } from "../../components/InviteButton";
import { DeleteAccountModal } from "../../components/DeleteAccountModal";
import { VerifyEmailBanner } from "../../components/VerifyEmailBanner";
import { PushPermissionBanner } from "../../components/PushPermissionBanner";
import { PullToRefreshIndicator } from "../../components/PullToRefreshIndicator";
import { SkateboardIcon, TrophyIcon } from "../../components/icons";
import { ClipsFeed } from "../../components/ClipsFeed";
import { useLobbyController } from "./useLobbyController";
import { LobbyHeader } from "./components/LobbyHeader";
import { ActiveGameCard } from "./components/ActiveGameCard";
import { CompletedGameCard } from "./components/CompletedGameCard";
import { PlayerDirectory } from "./components/PlayerDirectory";

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
        <VerifyEmailBanner emailVerified={user?.emailVerified ?? false} />
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

        <button
          type="button"
          onClick={user?.emailVerified ? onChallenge : undefined}
          disabled={!user?.emailVerified}
          className={`w-full flex items-center justify-center gap-2.5 rounded-2xl py-4 mb-1 font-display tracking-wider text-xl transition-all duration-300 ease-smooth focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange ${user?.emailVerified ? "bg-gradient-to-r from-brand-orange via-[#FF7A1A] to-[#FF8533] text-white active:scale-[0.97] hover:-translate-y-0.5 shadow-[0_2px_12px_rgba(255,107,0,0.2),0_1px_2px_rgba(0,0,0,0.1)] hover:shadow-[0_6px_28px_rgba(255,107,0,0.28),0_2px_6px_rgba(0,0,0,0.12)] ring-1 ring-white/[0.08]" : "bg-brand-orange/25 text-white/75 cursor-not-allowed border border-brand-orange/20"}`}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" />
            <line x1="12" y1="2" x2="12" y2="4.5" />
            <line x1="12" y1="19.5" x2="12" y2="22" />
            <line x1="2" y1="12" x2="4.5" y2="12" />
            <line x1="19.5" y1="12" x2="22" y2="12" />
          </svg>
          Challenge Someone
        </button>
        {!user?.emailVerified && (
          <p className="text-[11px] text-muted text-center mb-2 font-body">Verify your email to start challenging</p>
        )}

        <InviteButton username={profile.username} className="mb-3" />

        {user?.emailVerified && (
          <p className="font-body text-xs text-dim text-center mb-8">
            No one to play?{" "}
            <button
              type="button"
              onClick={() => onChallengeUser("mikewhite")}
              className="min-h-[44px] inline-flex items-center justify-center px-2 -mx-2 rounded-md text-brand-orange hover:text-[#FF7A1A] hover:bg-brand-orange/5 transition-colors underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            >
              Challenge @mikewhite
            </button>
          </p>
        )}

        {c.active.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">ACTIVE</h3>
              <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
                {c.liveActive.length}
              </span>
            </div>
            <div className="space-y-2">
              {c.active.map((g) => {
                const judgeViewer = c.isJudge(g) && !c.isPlayer(g);
                return (
                  <ActiveGameCard
                    key={g.id}
                    game={g}
                    judgeViewer={judgeViewer}
                    isMyTurn={c.isMyTurn(g)}
                    opponentName={c.opponent(g)}
                    opponentUid={c.opponentUid(g)}
                    opponentIsVerifiedPro={c.opponentIsVerifiedPro(g)}
                    myLetters={c.myLetters(g)}
                    theirLetters={c.theirLetters(g)}
                    turnLabel={c.turnLabel(g)}
                    cardButtonProps={c.cardButtonProps(() => onOpenGame(g))}
                    onOpenGame={() => onOpenGame(g)}
                    onViewPlayer={onViewPlayer}
                  />
                );
              })}
            </div>
          </div>
        )}

        {c.active.length === 0 && c.done.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">ACTIVE</h3>
              <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
                0
              </span>
            </div>
            <div className="flex flex-col items-center py-8 border border-dashed border-white/[0.06] rounded-2xl bg-surface/30 backdrop-blur-sm">
              <SkateboardIcon size={24} className="mb-2 text-faint" />
              <p className="font-body text-xs text-faint">No active games right now</p>
              <p className="font-body text-[11px] text-subtle mt-0.5">Challenge someone to start a new round</p>
            </div>
          </div>
        )}

        {c.done.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">COMPLETED</h3>
              <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
                {c.done.length}
              </span>
            </div>
            <div className="space-y-2">
              {c.done.map((g) => {
                const judgeViewer = c.isJudge(g) && !c.isPlayer(g);
                return (
                  <CompletedGameCard
                    key={g.id}
                    game={g}
                    judgeViewer={judgeViewer}
                    viewerUid={profile.uid}
                    opponentName={c.opponent(g)}
                    opponentUid={c.opponentUid(g)}
                    opponentIsVerifiedPro={c.opponentIsVerifiedPro(g)}
                    cardButtonProps={c.cardButtonProps(() => onOpenGame(g))}
                    onOpenGame={() => onOpenGame(g)}
                    onViewPlayer={onViewPlayer}
                  />
                );
              })}
            </div>
          </div>
        )}

        {c.done.length === 0 && c.active.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">COMPLETED</h3>
              <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
                0
              </span>
            </div>
            <div className="flex flex-col items-center py-8 border border-dashed border-white/[0.06] rounded-2xl bg-surface/30 backdrop-blur-sm">
              <TrophyIcon size={24} className="mb-2 text-faint" />
              <p className="font-body text-xs text-faint">No finished games yet</p>
              <p className="font-body text-[11px] text-subtle mt-0.5">Complete a game to see your results here</p>
            </div>
          </div>
        )}

        {hasMoreGames && games.length > 0 && (
          <div className="flex justify-center mb-6">
            <button
              type="button"
              onClick={onLoadMore}
              disabled={gamesLoading}
              className="px-6 py-2.5 rounded-2xl border border-border bg-surface/60 backdrop-blur-sm font-display text-sm tracking-wider text-brand-orange hover:border-brand-orange/30 hover:shadow-glow-sm hover:-translate-y-0.5 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange active:scale-[0.97]"
            >
              {gamesLoading ? "Loading..." : "Load More Games"}
            </button>
          </div>
        )}

        {games.length === 0 && (
          <div className="flex flex-col items-center py-12 px-6 border border-dashed border-white/[0.06] rounded-2xl mb-6 bg-surface/30 backdrop-blur-sm text-center">
            <svg
              className="text-brand-orange mb-4"
              width="38"
              height="38"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="7.5" cy="17.5" r="2.5" />
              <circle cx="17.5" cy="17.5" r="2.5" />
              <path d="M2 7h1.5l2.1 7.5h10.8l2.1-6H7.5" />
            </svg>
            <h2 className="font-display text-xl text-white tracking-wide">Ready to S.K.A.T.E.?</h2>
            <p className="font-body text-xs text-faint mt-2 max-w-[16rem]">
              Pick an opponent, record a trick, and call them out. First to spell S-K-A-T-E loses.
            </p>
            {user?.emailVerified ? (
              <button
                type="button"
                onClick={onChallenge}
                className="mt-5 min-h-[44px] inline-flex items-center gap-2 rounded-xl px-5 font-display text-sm tracking-wider bg-brand-orange/10 border border-brand-orange/30 text-brand-orange hover:bg-brand-orange/15 hover:border-brand-orange/50 transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              >
                Challenge your first opponent →
              </button>
            ) : (
              <p className="mt-4 font-body text-[11px] text-subtle">Verify your email to start a game</p>
            )}
          </div>
        )}

        <PlayerDirectory
          players={c.players}
          loading={c.playersLoading}
          user={user}
          onViewPlayer={onViewPlayer}
          onChallengeUser={onChallengeUser}
        />

        <div className="mt-8 flex flex-col items-center gap-1">
          {onDownloadData && (
            <button
              type="button"
              onClick={c.handleDownload}
              disabled={c.downloadingData}
              aria-label="Download a copy of my data"
              className="touch-target inline-flex items-center justify-center font-body text-xs text-dim underline underline-offset-2 hover:text-brand-orange transition-colors disabled:opacity-60 disabled:cursor-wait rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            >
              {c.downloadingData ? "Preparing your data…" : "Download My Data"}
            </button>
          )}
          {c.downloadError && (
            <p role="alert" className="font-body text-xs text-brand-red max-w-xs text-center">
              {c.downloadError}
            </p>
          )}
          <button
            type="button"
            onClick={c.openDeleteModal}
            className="touch-target inline-flex items-center justify-center font-body text-xs text-dim underline underline-offset-2 hover:text-brand-red transition-colors rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red"
          >
            Delete Account
          </button>
        </div>

        <div className="brand-watermark mt-6">
          <div className="brand-divider flex-1 max-w-16" />
          <img src="/logonew.webp" alt="" draggable={false} className="h-4 w-auto select-none" aria-hidden="true" />
          <div className="brand-divider flex-1 max-w-16" />
        </div>
      </div>

      {c.showDeleteModal && <DeleteAccountModal onClose={c.closeDeleteModal} onDeleteAccount={onDeleteAccount} />}
    </div>
  );
}
