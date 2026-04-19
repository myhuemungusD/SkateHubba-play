import { useState, useEffect, type FocusEvent, type KeyboardEvent } from "react";
import { type UserProfile, getPlayerDirectory } from "../services/users";
import { getBlockedUserIds } from "../services/blocking";
import { logger } from "../services/logger";
import type { GameDoc } from "../services/games";
import { LETTERS } from "../utils/helpers";
import { InviteButton } from "../components/InviteButton";
import { DeleteAccountModal } from "../components/DeleteAccountModal";
import { VerifyEmailBanner } from "../components/VerifyEmailBanner";
import { NotificationBell } from "../components/NotificationBell";
import { PushPermissionBanner } from "../components/PushPermissionBanner";
import { LobbyTimer } from "../components/LobbyTimer";
import { SkateboardIcon, TrophyIcon, ChevronRightIcon } from "../components/icons";
import { ProUsername } from "../components/ProUsername";
import { ClipsFeed } from "../components/ClipsFeed";

/** True when a game's turn deadline has passed. */
function isGameExpired(g: GameDoc): boolean {
  const deadline = g.turnDeadline?.toMillis?.() ?? 0;
  return deadline > 0 && deadline <= Date.now();
}

function relativeJoinDate(createdAt: unknown): string {
  if (
    !createdAt ||
    typeof createdAt !== "object" ||
    !("toMillis" in createdAt) ||
    typeof (createdAt as { toMillis: unknown }).toMillis !== "function"
  )
    return "Joined";
  const millis = (createdAt as { toMillis: () => number }).toMillis();
  const ms = Date.now() - millis;
  if (ms < 0) return "Just joined"; // future timestamp (clock skew)
  const hours = ms / 3_600_000;
  if (hours < 1) return "Just joined";
  if (hours < 24) return `Joined ${Math.floor(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Joined ${days}d ago`;
  const d = new Date(millis);
  const month = d.toLocaleString("en-US", { month: "short" });
  return `Joined ${month} ${d.getDate()}`;
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
}: {
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
}) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [downloadingData, setDownloadingData] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [players, setPlayers] = useState<UserProfile[]>([]);
  const [playersLoading, setPlayersLoading] = useState(true);
  useEffect(() => {
    let stale = false;
    Promise.all([getPlayerDirectory(), getBlockedUserIds(profile.uid)])
      .then(([all, blockedIds]) => {
        if (!stale) setPlayers(all.filter((p) => p.uid !== profile.uid && !blockedIds.has(p.uid)));
      })
      .catch((err) => {
        // Non-critical: show empty lobby rather than error screen
        logger.warn("[Lobby] player directory load failed", err);
        if (!stale) setPlayers([]);
      })
      .finally(() => {
        if (!stale) setPlayersLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [profile.uid]);

  const active = games.filter((g) => g.status === "active");
  const done = games.filter((g) => g.status !== "active");

  // Games whose turn deadline has passed aren't truly playable — they're
  // pending forfeit resolution (GameContext auto-triggers forfeitExpiredTurn
  // on the subscription, but there's a brief window before Firestore pushes
  // the updated status). Show the narrower count so the counter reflects
  // reality, not stale server state.
  const liveActive = active.filter((g) => !isGameExpired(g));

  const isJudge = (g: GameDoc) => !!g.judgeId && g.judgeId === profile.uid;
  const isPlayer = (g: GameDoc) => g.player1Uid === profile.uid || g.player2Uid === profile.uid;
  const opponent = (g: GameDoc) => (g.player1Uid === profile.uid ? g.player2Username : g.player1Username);
  const opponentUid = (g: GameDoc) => (g.player1Uid === profile.uid ? g.player2Uid : g.player1Uid);
  const opponentIsVerifiedPro = (g: GameDoc) =>
    g.player1Uid === profile.uid ? g.player2IsVerifiedPro : g.player1IsVerifiedPro;

  const isMyTurn = (g: GameDoc) => g.currentTurn === profile.uid;

  const myLetters = (g: GameDoc) => (g.player1Uid === profile.uid ? g.p1Letters : g.p2Letters);
  const theirLetters = (g: GameDoc) => (g.player1Uid === profile.uid ? g.p2Letters : g.p1Letters);

  const turnLabel = (g: GameDoc) => {
    const trick = g.currentTrickName || "Trick";
    // Judge-specific labels
    if (isJudge(g) && !isPlayer(g)) {
      if (isMyTurn(g)) {
        if (g.phase === "disputable") return "Rule: landed or missed?";
        if (g.phase === "setReview") return "Rule: clean or sketchy?";
      }
      if (g.phase === "disputable" || g.phase === "setReview") return "Awaiting your ruling";
      if (g.phase === "matching") return `Matching: ${trick}`;
      return "Setting a trick";
    }
    // Player-specific labels
    if (g.phase === "disputable" || g.phase === "setReview") {
      return g.judgeUsername ? `Referee @${g.judgeUsername} reviewing` : "Under review";
    }
    if (isMyTurn(g)) {
      if (g.phase === "matching") return `Match: ${trick}`;
      return "Your turn to set";
    }
    if (g.phase === "matching") return `Matching: ${trick}`;
    return "They're setting a trick";
  };

  // Activate a card on Enter/Space with full native <button> keyboard parity.
  // Game cards are div[role="button"] (not native <button>) so we can host
  // the inner Profile <button> without the invalid-HTML nested-interactive
  // tree. We approximate native semantics precisely:
  //   - Enter fires on keydown (matches native activation).
  //   - Space is primed on keydown (preventing page scroll) and fires on
  //     keyup, so the user can move focus off the card to cancel before
  //     release — which native <button> supports and a naive keydown-only
  //     handler breaks.
  //   - The "primed" flag lives on the element itself via data-space-primed
  //     so it survives parent re-renders (e.g. LobbyTimer ticks) between
  //     keydown and keyup.
  //   - Blur clears the primed flag, matching native cancel-on-focus-loss.
  //   - e.repeat guards auto-repeat when a key is held.
  const cardButtonProps = (
    handler: () => void,
  ): {
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
    onKeyUp: (e: KeyboardEvent<HTMLElement>) => void;
    onBlur: (e: FocusEvent<HTMLElement>) => void;
  } => ({
    onKeyDown: (e) => {
      if (e.repeat) return;
      if (e.key === "Enter") {
        e.preventDefault();
        handler();
      } else if (e.key === " ") {
        e.preventDefault();
        e.currentTarget.dataset.spacePrimed = "true";
      }
    },
    onKeyUp: (e) => {
      if (e.key === " " && e.currentTarget.dataset.spacePrimed === "true") {
        delete e.currentTarget.dataset.spacePrimed;
        e.preventDefault();
        handler();
      }
    },
    onBlur: (e) => {
      delete e.currentTarget.dataset.spacePrimed;
    },
  });

  return (
    <div className="min-h-dvh bg-[#0A0A0A]/40 pb-24">
      {/* Header */}
      <div className="px-5 pt-safe pb-4 flex justify-between items-center border-b border-white/[0.04] glass max-w-2xl mx-auto">
        <img src="/logonew.webp" alt="" draggable={false} className="h-7 w-auto select-none" aria-hidden="true" />
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onViewRecord}
            className="flex items-center gap-2 transition-all duration-300 group rounded-xl px-2 py-1.5 touch-target hover:bg-white/[0.03]"
            title="View my record"
          >
            <div className="w-7 h-7 rounded-full bg-brand-orange/10 border border-brand-orange/20 flex items-center justify-center shrink-0 group-hover:shadow-glow-sm group-hover:border-brand-orange/40 transition-all duration-300">
              <span className="font-display text-[11px] text-brand-orange leading-none">
                {profile.username[0].toUpperCase()}
              </span>
            </div>
            <ProUsername
              username={profile.username}
              isVerifiedPro={profile.isVerifiedPro}
              className="font-body text-xs text-brand-orange group-hover:text-[#FF8533] transition-colors duration-300"
            />
          </button>
          <NotificationBell games={games} onOpenGame={onOpenGame} />
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="Settings"
              className="touch-target inline-flex items-center justify-center rounded-xl border border-border hover:border-border-hover hover:bg-white/[0.02] text-dim hover:text-white transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={onSignOut}
            className="font-body text-xs text-dim hover:text-white transition-all duration-300 px-3 py-1.5 touch-target inline-flex items-center justify-center rounded-xl border border-border hover:border-border-hover hover:bg-white/[0.02]"
          >
            Sign Out
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto">
        <VerifyEmailBanner emailVerified={user?.emailVerified ?? false} />
        <PushPermissionBanner uid={profile.uid} />
      </div>

      <div className="px-5 pt-7 max-w-lg mx-auto">
        {/* Community feed — surfaced at the top of the lobby so the first
            thing users see is a live, autoplaying clip. Placement also
            keeps the top clip in the viewport on mount, which is what
            makes muted autoplay actually fire on mobile browsers. */}
        <ClipsFeed profile={profile} onViewPlayer={onViewPlayer ?? (() => {})} onChallengeUser={onChallengeUser} />

        {/* Page header */}
        <div className="mb-7">
          <h1 className="font-display text-fluid-4xl leading-none text-white tracking-wide">Your Games</h1>
          {games.length > 0 && (
            <p className="font-body text-xs text-brand-green mt-1.5">
              {liveActive.length > 0 ? `${liveActive.length} active` : "No active games"}
              {done.length > 0 ? ` · ${done.length} completed` : ""}
            </p>
          )}
        </div>

        {/* Primary CTA — Challenge */}
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

        {/* Active games */}
        {active.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">ACTIVE</h3>
              <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
                {liveActive.length}
              </span>
            </div>
            <div className="space-y-2">
              {active.map((g) => {
                const judgeViewer = isJudge(g) && !isPlayer(g);
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={g.id}
                    onClick={() => onOpenGame(g)}
                    {...cardButtonProps(() => onOpenGame(g))}
                    className={`relative flex items-center justify-between p-4 rounded-2xl cursor-pointer select-none transition-all duration-300 ease-smooth overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange text-left w-full
                    ${
                      isMyTurn(g)
                        ? "glass-card border-brand-orange/30 shadow-glow-sm hover:shadow-glow-md hover:-translate-y-0.5"
                        : "glass-card hover:border-white/[0.1] hover:-translate-y-0.5"
                    }`}
                  >
                    {isMyTurn(g) && (
                      <div
                        className="absolute left-0 top-0 bottom-0 w-[3px] bg-brand-orange rounded-l-2xl"
                        aria-hidden="true"
                      />
                    )}
                    <div className="pl-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {judgeViewer ? (
                          <span className="font-display text-[19px] text-white leading-none">
                            <span className="text-amber-400 text-[11px] tracking-wider align-middle mr-1.5">REF</span>@
                            {g.player1Username} vs @{g.player2Username}
                          </span>
                        ) : (
                          <span className="font-display text-[19px] text-white leading-none">
                            vs <ProUsername username={opponent(g)} isVerifiedPro={opponentIsVerifiedPro(g)} />
                          </span>
                        )}
                        {onViewPlayer && !judgeViewer && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onViewPlayer(opponentUid(g));
                            }}
                            className="min-h-[32px] inline-flex items-center justify-center px-2 -mx-2 rounded-md font-display text-[10px] text-brand-orange hover:text-[#FF7A1A] hover:bg-brand-orange/10 transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                            aria-label={`View @${opponent(g)}'s profile`}
                          >
                            Profile
                          </button>
                        )}
                        {isMyTurn(g) && (
                          <span
                            className={`px-2 py-0.5 rounded font-display text-[10px] text-white tracking-wider leading-none shrink-0 ${judgeViewer ? "bg-amber-500" : "bg-brand-orange"}`}
                          >
                            {judgeViewer ? "RULE" : "PLAY"}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-body text-[11px] ${isMyTurn(g) ? (judgeViewer ? "text-amber-400" : "text-brand-orange") : "text-brand-green"}`}
                        >
                          {turnLabel(g)}
                        </span>
                        <LobbyTimer deadline={g.turnDeadline?.toMillis?.() ?? 0} isMyTurn={isMyTurn(g)} />
                      </div>
                      {judgeViewer ? (
                        <div className="flex items-center gap-3 mt-2.5">
                          <div className="flex items-center gap-1">
                            <span className="font-body text-[10px] text-amber-400 uppercase tracking-wider mr-0.5">
                              @{g.player1Username}
                            </span>
                            {LETTERS.map((l, i) => (
                              <span
                                key={i}
                                className={`font-display text-[13px] leading-none tracking-wide ${i < g.p1Letters ? "text-brand-red" : "text-faint"}`}
                              >
                                {l}
                              </span>
                            ))}
                          </div>
                          <div className="w-px h-3 bg-border shrink-0" aria-hidden="true" />
                          <div className="flex items-center gap-1">
                            <span className="font-body text-[10px] text-amber-400 uppercase tracking-wider mr-0.5">
                              @{g.player2Username}
                            </span>
                            {LETTERS.map((l, i) => (
                              <span
                                key={i}
                                className={`font-display text-[13px] leading-none tracking-wide ${i < g.p2Letters ? "text-brand-red" : "text-[#2E2E2E]"}`}
                              >
                                {l}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 mt-2.5">
                          <div className="flex items-center gap-1">
                            <span className="font-body text-[10px] text-brand-orange uppercase tracking-wider mr-0.5">
                              You
                            </span>
                            {LETTERS.map((l, i) => (
                              <span
                                key={i}
                                className={`font-display text-[13px] leading-none tracking-wide ${i < myLetters(g) ? "text-brand-red" : "text-faint"}`}
                              >
                                {l}
                              </span>
                            ))}
                          </div>
                          <div className="w-px h-3 bg-border shrink-0" aria-hidden="true" />
                          <div className="flex items-center gap-1">
                            <span className="font-body text-[10px] text-brand-orange uppercase tracking-wider mr-0.5">
                              Them
                            </span>
                            {LETTERS.map((l, i) => (
                              <span
                                key={i}
                                className={`font-display text-[13px] leading-none tracking-wide ${i < theirLetters(g) ? "text-brand-red" : "text-[#2E2E2E]"}`}
                              >
                                {l}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <ChevronRightIcon
                      size={15}
                      className={`shrink-0 ml-3 ${isMyTurn(g) ? "text-brand-orange" : "text-faint"}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Active empty state */}
        {active.length === 0 && done.length > 0 && (
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

        {/* Completed games */}
        {done.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">COMPLETED</h3>
              <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
                {done.length}
              </span>
            </div>
            <div className="space-y-2">
              {done.map((g) => {
                const judgeViewer = isJudge(g) && !isPlayer(g);
                const winnerName = g.winner === g.player1Uid ? g.player1Username : g.player2Username;
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={g.id}
                    onClick={() => onOpenGame(g)}
                    {...cardButtonProps(() => onOpenGame(g))}
                    className="flex items-center justify-between p-4 rounded-2xl glass-card cursor-pointer select-none transition-all duration-300 ease-smooth opacity-75 hover:opacity-100 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange text-left w-full"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        {judgeViewer ? (
                          <span className="font-display text-[19px] text-white leading-none">
                            <span className="text-amber-400 text-[11px] tracking-wider align-middle mr-1.5">REF</span>@
                            {g.player1Username} vs @{g.player2Username}
                          </span>
                        ) : (
                          <span className="font-display text-[19px] text-white leading-none">
                            vs <ProUsername username={opponent(g)} isVerifiedPro={opponentIsVerifiedPro(g)} />
                          </span>
                        )}
                        {onViewPlayer && !judgeViewer && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onViewPlayer(opponentUid(g));
                            }}
                            className="min-h-[32px] inline-flex items-center justify-center px-2 -mx-2 rounded-md font-display text-[10px] text-brand-orange hover:text-[#FF7A1A] hover:bg-brand-orange/10 transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                            aria-label={`View @${opponent(g)}'s profile`}
                          >
                            Profile
                          </button>
                        )}
                      </div>
                      <span
                        className={`font-body text-[11px] ${judgeViewer ? "text-subtle" : g.winner === profile.uid ? "text-brand-green" : "text-brand-red"}`}
                      >
                        {judgeViewer
                          ? `@${winnerName} won${g.status === "forfeit" ? " · forfeit" : ""}`
                          : `${g.winner === profile.uid ? "You won" : "You lost"}${g.status === "forfeit" ? " · forfeit" : ""}`}
                      </span>
                    </div>
                    <ChevronRightIcon size={15} className="text-faint shrink-0" />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Completed empty state */}
        {done.length === 0 && active.length > 0 && (
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

        {/* Load More */}
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

        {/* Empty state — no games at all. Leading with an explicit CTA here
            (rather than just descriptive text pointing at the button above)
            is a meaningful win for first-run users who may have scrolled past
            the primary Challenge button without clocking it as the next step. */}
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

        {/* Player Directory */}
        {playersLoading && <p className="font-body text-xs text-brand-orange text-center mb-6">Loading skaters...</p>}
        {!playersLoading && players.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">SKATERS</h3>
              <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
                {players.length}
              </span>
            </div>
            <div className="space-y-2">
              {players.map((p) => (
                <div
                  key={p.uid}
                  className="flex items-center justify-between p-4 rounded-2xl glass-card transition-all duration-300 ease-smooth"
                >
                  <button
                    type="button"
                    onClick={() => onViewPlayer?.(p.uid)}
                    className="flex items-center gap-3 min-w-0 text-left cursor-pointer hover:opacity-80 transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                    aria-label={`View @${p.username}'s profile`}
                  >
                    <div className="w-8 h-8 rounded-full bg-brand-orange/10 border border-brand-orange/20 flex items-center justify-center shrink-0">
                      <span className="font-display text-[11px] text-brand-orange leading-none">
                        {p.username[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <ProUsername
                        username={p.username}
                        isVerifiedPro={p.isVerifiedPro}
                        className="font-display text-base text-white block leading-none"
                      />
                      <span className="font-body text-[11px] text-brand-green block mt-1">
                        {p.stance}
                        {p.createdAt ? ` \u00B7 ${relativeJoinDate(p.createdAt)}` : ""}
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onChallengeUser(p.username)}
                    disabled={!user?.emailVerified}
                    className={`font-display text-xs shrink-0 ml-3 px-3 py-1.5 touch-target inline-flex items-center justify-center rounded-lg border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange ${user?.emailVerified ? "text-brand-orange border-brand-orange/30 hover:bg-brand-orange/10 cursor-pointer" : "text-subtle border-border cursor-not-allowed opacity-60"}`}
                    aria-label={`Challenge @${p.username}`}
                  >
                    Challenge
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Delete Account */}
        <div className="mt-8 flex flex-col items-center gap-1">
          {onDownloadData && (
            <button
              type="button"
              onClick={async () => {
                if (downloadingData) return;
                setDownloadError("");
                setDownloadingData(true);
                try {
                  await onDownloadData();
                } catch (err) {
                  setDownloadError(err instanceof Error ? err.message : "Export failed — try again");
                } finally {
                  setDownloadingData(false);
                }
              }}
              disabled={downloadingData}
              aria-label="Download a copy of my data"
              className="touch-target inline-flex items-center justify-center font-body text-xs text-dim underline underline-offset-2 hover:text-brand-orange transition-colors disabled:opacity-60 disabled:cursor-wait rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            >
              {downloadingData ? "Preparing your data…" : "Download My Data"}
            </button>
          )}
          {downloadError && (
            <p role="alert" className="font-body text-xs text-brand-red max-w-xs text-center">
              {downloadError}
            </p>
          )}
          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            className="touch-target inline-flex items-center justify-center font-body text-xs text-dim underline underline-offset-2 hover:text-brand-red transition-colors rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red"
          >
            Delete Account
          </button>
        </div>

        {/* Brand watermark */}
        <div className="brand-watermark mt-6">
          <div className="brand-divider flex-1 max-w-16" />
          <img src="/logonew.webp" alt="" draggable={false} className="h-4 w-auto select-none" aria-hidden="true" />
          <div className="brand-divider flex-1 max-w-16" />
        </div>
      </div>

      {showDeleteModal && (
        <DeleteAccountModal onClose={() => setShowDeleteModal(false)} onDeleteAccount={onDeleteAccount} />
      )}
    </div>
  );
}
