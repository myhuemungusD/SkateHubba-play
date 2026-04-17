import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { GameDoc } from "../services/games";
import type { UserProfile } from "../services/users";
import { blockUser, unblockUser } from "../services/blocking";
import { usePlayerProfile } from "../hooks/usePlayerProfile";
import { LETTERS } from "../utils/helpers";
import { trackEvent } from "../services/analytics";
import { TurnHistoryViewer } from "../components/TurnHistoryViewer";
import { GameReplay } from "../components/GameReplay";
import { Btn } from "../components/ui/Btn";
import {
  TrophyIcon,
  SkullIcon,
  FlameIcon,
  SkateboardIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "../components/icons";
import { ProUsername } from "../components/ProUsername";

/* ── Types ────────────────────────────────────────────── */

interface OpponentRecord {
  uid: string;
  username: string;
  wins: number;
  losses: number;
  totalGames: number;
  isVerifiedPro?: boolean;
}

/* ── Helpers ──────────────────────────────────────────── */

function formatDate(ts: { toMillis?: () => number } | null): string {
  if (!ts || typeof ts.toMillis !== "function") return "";
  const d = new Date(ts.toMillis());
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function opponentName(g: GameDoc, uid: string): string {
  return g.player1Uid === uid ? g.player2Username : g.player1Username;
}

function playerLetterCount(g: GameDoc, uid: string): number {
  return g.player1Uid === uid ? g.p1Letters : g.p2Letters;
}

function opponentLetterCount(g: GameDoc, uid: string): number {
  return g.player1Uid === uid ? g.p2Letters : g.p1Letters;
}

/* ── Component ────────────────────────────────────────── */

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
}: {
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
}) {
  const fetchedData = usePlayerProfile(isOwnProfile ? "" : viewedUid, currentUserProfile.uid);

  // Determine which profile and games to use
  const profile = isOwnProfile ? currentUserProfile : fetchedData.profile;
  const games = isOwnProfile ? ownGames : fetchedData.games;
  const loading = isOwnProfile ? false : fetchedData.loading;
  const error = isOwnProfile ? null : fetchedData.error;

  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);
  const [blockLoading, setBlockLoading] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const isBlocked = blockedUids?.has(viewedUid) ?? false;

  const toggleExpanded = useCallback((id: string) => {
    setExpandedGameId((prev) => (prev === id ? null : id));
  }, []);

  // Completed games only, sorted newest first
  const completedGames = useMemo(
    () =>
      games
        .filter((g) => g.status === "complete" || g.status === "forfeit")
        .sort((a, b) => {
          const aTime = a.updatedAt?.toMillis?.() ?? 0;
          const bTime = b.updatedAt?.toMillis?.() ?? 0;
          return bTime - aTime;
        }),
    [games],
  );

  // Aggregate stats
  const stats = useMemo(() => {
    const empty = {
      wins: 0,
      losses: 0,
      total: 0,
      winRate: 0,
      totalTricks: 0,
      tricksLanded: 0,
      landRate: 0,
      longestStreak: 0,
      currentStreak: 0,
      vsYouWins: 0,
      vsYouLosses: 0,
      vsYouTotal: 0,
    };
    if (!profile) return empty;

    let wins = 0;
    let losses = 0;
    let totalTricks = 0;
    let tricksLanded = 0;
    let longestStreak = 0;
    let currentStreak = 0;

    const chronological = [...completedGames].reverse();

    for (const g of chronological) {
      const won = g.winner === profile.uid;
      if (won) {
        wins++;
        currentStreak++;
        if (currentStreak > longestStreak) longestStreak = currentStreak;
      } else {
        losses++;
        currentStreak = 0;
      }

      for (const t of g.turnHistory ?? []) {
        totalTricks++;
        if (t.landed) tricksLanded++;
      }
    }

    // When viewing another player, use profile-level stats for overall W/L
    // since we only have shared games (Firestore rules restrict game reads
    // to participants). For own profile, compute from full game history.
    const finalWins = isOwnProfile ? wins : (profile.wins ?? 0);
    const finalLosses = isOwnProfile ? losses : (profile.losses ?? 0);
    const total = finalWins + finalLosses;
    const winRate = total > 0 ? Math.round((finalWins / total) * 100) : 0;

    // Shared game stats use the game-computed values (these are "vs you" when viewing others)
    const landRate = totalTricks > 0 ? Math.round((tricksLanded / totalTricks) * 100) : 0;

    // VS YOU stats — wins/losses from shared games, from the current viewer's perspective
    const vsYouWins = losses; // viewer wins when viewed player loses
    const vsYouLosses = wins; // viewer loses when viewed player wins

    return {
      wins: finalWins,
      losses: finalLosses,
      total,
      winRate,
      totalTricks,
      tricksLanded,
      landRate,
      longestStreak,
      currentStreak,
      vsYouWins,
      vsYouLosses,
      vsYouTotal: vsYouWins + vsYouLosses,
    };
  }, [completedGames, profile, isOwnProfile]);

  // Opponent head-to-head records
  const opponents = useMemo(() => {
    if (!profile) return [];
    const map = new Map<string, OpponentRecord>();

    for (const g of completedGames) {
      const isP1 = g.player1Uid === profile.uid;
      const oppUid = isP1 ? g.player2Uid : g.player1Uid;
      const oppName = isP1 ? g.player2Username : g.player1Username;
      const oppIsPro = isP1 ? g.player2IsVerifiedPro : g.player1IsVerifiedPro;
      const won = g.winner === profile.uid;

      let rec = map.get(oppUid);
      if (!rec) {
        rec = { uid: oppUid, username: oppName, wins: 0, losses: 0, totalGames: 0, isVerifiedPro: oppIsPro };
        map.set(oppUid, rec);
      }
      if (won) rec.wins++;
      else rec.losses++;
      rec.totalGames++;
    }

    return Array.from(map.values()).sort((a, b) => b.totalGames - a.totalGames);
  }, [completedGames, profile]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-[#0A0A0A]/80">
        <div className="relative w-10 h-10 mb-4">
          <div className="absolute inset-0 rounded-full border-2 border-border" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-brand-orange animate-spin" />
        </div>
        <span className="font-body text-xs text-muted">Loading player profile...</span>
      </div>
    );
  }

  // Error state
  if (error || !profile) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center px-6 bg-[#0A0A0A]/80">
        <SkateboardIcon size={32} className="mb-4 opacity-40 text-subtle" />
        <p className="font-body text-sm text-faint mb-4">{error ?? "Player not found"}</p>
        <Btn onClick={onBack} variant="ghost">
          Back to Lobby
        </Btn>
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-24 overflow-y-auto bg-profile-glow">
      {/* Header */}
      <div className="px-5 pt-safe pb-4 flex justify-between items-center border-b border-white/[0.04] glass">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 touch-target text-muted hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange rounded-lg"
          aria-label="Back to lobby"
        >
          <ChevronLeftIcon size={16} />
          <span className="font-body text-xs">Lobby</span>
        </button>
        <img
          src="/logonew.webp"
          alt=""
          draggable={false}
          className="h-5 w-auto select-none opacity-40"
          aria-hidden="true"
        />
        {/* Spacer to center logo */}
        <div className="w-16" aria-hidden="true" />
      </div>

      <div className="px-5 pt-7 max-w-lg mx-auto">
        {/* Player identity */}
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

        {/* Challenge button for other players (hidden when blocked) */}
        {!isOwnProfile && onChallenge && !isBlocked && (
          <Btn onClick={() => onChallenge(profile.uid, profile.username)} className="w-full mb-4">
            Challenge @{profile.username}
          </Btn>
        )}

        {/* Block / Unblock controls */}
        {!isOwnProfile && (
          <div className="mb-8">
            {isBlocked ? (
              <div className="flex items-center justify-between p-3 rounded-xl border border-brand-red/20 bg-brand-red/[0.06]">
                <span className="font-body text-xs text-brand-red">You have blocked this user</span>
                <button
                  type="button"
                  onClick={async () => {
                    setBlockLoading(true);
                    try {
                      await unblockUser(currentUserProfile.uid, profile.uid);
                    } finally {
                      setBlockLoading(false);
                    }
                  }}
                  disabled={blockLoading}
                  className="touch-target inline-flex items-center justify-center font-body text-xs text-muted hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-border hover:border-border-hover disabled:opacity-50"
                >
                  {blockLoading ? "..." : "Unblock"}
                </button>
              </div>
            ) : (
              <>
                {showBlockConfirm ? (
                  <div className="flex items-center justify-between p-3 rounded-xl border border-brand-red/20 bg-brand-red/[0.06]">
                    <span className="font-body text-xs text-subtle">
                      Block @{profile.username}? They won&apos;t be able to challenge you.
                    </span>
                    <div className="flex gap-2 shrink-0 ml-3">
                      <button
                        type="button"
                        onClick={() => setShowBlockConfirm(false)}
                        className="touch-target inline-flex items-center justify-center font-body text-xs text-muted hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-border"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setBlockLoading(true);
                          try {
                            await blockUser(currentUserProfile.uid, profile.uid);
                            setShowBlockConfirm(false);
                          } finally {
                            setBlockLoading(false);
                          }
                        }}
                        disabled={blockLoading}
                        className="touch-target inline-flex items-center justify-center font-body text-xs text-brand-red hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-brand-red/30 hover:bg-brand-red/20 disabled:opacity-50"
                      >
                        {blockLoading ? "..." : "Block"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowBlockConfirm(true)}
                    className="touch-target inline-flex items-center font-body text-xs text-subtle hover:text-brand-red transition-colors"
                  >
                    Block this player
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Overall stats */}
        <div className="grid grid-cols-3 gap-2.5 mb-2.5 animate-fade-in">
          <StatCard label="Wins" value={stats.wins} color="text-brand-green" />
          <StatCard label="Losses" value={stats.losses} color="text-brand-red" />
          <StatCard
            label="Win Rate"
            value={`${stats.winRate}%`}
            color={stats.winRate >= 50 ? "text-brand-orange" : "text-muted"}
          />
        </div>

        {isOwnProfile ? (
          <>
            <div className="grid grid-cols-3 gap-2.5 mb-2.5 animate-fade-in">
              <StatCard label="Games" value={stats.total} color="text-white" />
              <StatCard label="Best Streak" value={stats.longestStreak} color="text-brand-orange" />
              <StatCard
                label="Land Rate"
                value={`${stats.landRate}%`}
                color={stats.landRate >= 50 ? "text-brand-green" : "text-muted"}
              />
            </div>

            <div className="grid grid-cols-3 gap-2.5 mb-8 animate-fade-in">
              <StatCard label="Total Turns" value={stats.totalTricks} color="text-white" />
              <StatCard label="Landed" value={stats.tricksLanded} color="text-brand-green" />
              <StatCard label="Missed" value={stats.totalTricks - stats.tricksLanded} color="text-brand-red" />
            </div>
          </>
        ) : (
          <div className="mb-6" />
        )}

        {/* VS YOU stats — only shown on other players' profiles */}
        {!isOwnProfile && completedGames.length > 0 && (
          <>
            <p className="font-display text-[10px] tracking-[0.2em] text-brand-orange mb-2.5 animate-fade-in">VS YOU</p>
            <div className="grid grid-cols-3 gap-2.5 mb-8 animate-fade-in">
              <StatCard label="Your Wins" value={stats.vsYouWins} color="text-brand-green" />
              <StatCard label="Your Losses" value={stats.vsYouLosses} color="text-brand-red" />
              <StatCard label="Games" value={stats.vsYouTotal} color="text-white" />
            </div>
          </>
        )}

        {/* Current streak callout — only shown on own profile */}
        {isOwnProfile && stats.currentStreak >= 2 && (
          <div
            className="flex items-center justify-center gap-2.5 mb-8 px-4 py-3.5 rounded-xl border border-brand-orange/30 bg-brand-orange/[0.06] shadow-glow-sm animate-scale-in"
            role="status"
            aria-label={`${stats.currentStreak} game win streak`}
          >
            <FlameIcon size={18} className="text-brand-orange" />
            <span className="font-display text-sm tracking-wider text-brand-orange">
              {stats.currentStreak} WIN STREAK
            </span>
            <FlameIcon size={18} className="text-brand-orange" />
          </div>
        )}

        {/* Opponents / H2H section */}
        {opponents.length > 0 && (
          <div className="mb-8 animate-fade-in">
            <SectionHeader title={isOwnProfile ? "OPPONENTS" : "HEAD TO HEAD"} count={opponents.length} />
            <div className="space-y-2">
              {opponents.map((opp) => {
                const isTappable = onViewPlayer && opp.uid !== currentUserProfile.uid;
                const Wrapper = isTappable ? "button" : "div";
                return (
                  <Wrapper
                    key={opp.uid}
                    {...(isTappable
                      ? {
                          type: "button" as const,
                          onClick: () => onViewPlayer!(opp.uid),
                        }
                      : {})}
                    className={`flex items-center justify-between p-4 rounded-2xl glass-card transition-all duration-300 ${
                      isTappable ? "w-full text-left cursor-pointer hover:border-white/[0.1]" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-surface-alt border border-border flex items-center justify-center shrink-0">
                        <span className="font-display text-[11px] text-brand-orange leading-none">
                          {opp.username[0].toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <ProUsername
                          username={opp.username}
                          isVerifiedPro={opp.isVerifiedPro}
                          className="font-display text-base text-white block leading-none truncate"
                        />
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-body text-[11px] text-brand-green">{opp.wins}W</span>
                          <span className="font-body text-[11px] text-brand-red">{opp.losses}L</span>
                          <span className="font-body text-[11px] text-subtle">
                            {opp.totalGames} {opp.totalGames === 1 ? "game" : "games"}
                          </span>
                        </div>
                      </div>
                    </div>
                    {/* H2H indicator */}
                    <div
                      className="shrink-0 ml-3"
                      aria-label={
                        opp.wins > opp.losses ? "You lead" : opp.wins < opp.losses ? "They lead" : "Even record"
                      }
                    >
                      {opp.wins > opp.losses ? (
                        <TrophyIcon size={16} className="text-brand-green" />
                      ) : opp.wins < opp.losses ? (
                        <SkullIcon size={16} className="text-brand-red" />
                      ) : (
                        <span className="font-display text-[10px] tracking-wider text-subtle">EVEN</span>
                      )}
                    </div>
                  </Wrapper>
                );
              })}
            </div>
          </div>
        )}

        {/* Game history */}
        <div className="mb-6 animate-fade-in">
          <SectionHeader title={isOwnProfile ? "GAME HISTORY" : "GAMES VS YOU"} count={completedGames.length} />

          {completedGames.length === 0 ? (
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
              {completedGames.map((g) => (
                <GameHistoryCard
                  key={g.id}
                  game={g}
                  profileUid={profile.uid}
                  expanded={expandedGameId === g.id}
                  onToggle={toggleExpanded}
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

/* ── Sub-components ───────────────────────────────────── */

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">{title}</h3>
      <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
        {count}
      </span>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="flex flex-col items-center py-4 px-2 rounded-2xl glass-card">
      <span className={`font-display text-2xl leading-none tabular-nums ${color}`}>{value}</span>
      <span className="font-body text-[10px] text-subtle mt-2.5 uppercase tracking-wider">{label}</span>
    </div>
  );
}

function LetterScore({ count, label }: { count: number; label: string }) {
  return (
    <div
      className="flex items-center gap-1"
      aria-label={`${label}: ${LETTERS.slice(0, count).join(".")}${count > 0 ? "." : "none"}`}
    >
      {LETTERS.map((l, i) => (
        <span
          key={i}
          className={`font-display text-[11px] leading-none ${i < count ? "text-brand-red" : "text-[#2E2E2E]"}`}
        >
          {l}
        </span>
      ))}
    </div>
  );
}

function GameHistoryCard({
  game,
  profileUid,
  expanded,
  onToggle,
  onOpenGame,
}: {
  game: GameDoc;
  profileUid: string;
  expanded: boolean;
  onToggle: (id: string) => void;
  onOpenGame: (g: GameDoc) => void;
}) {
  const won = game.winner === profileUid;
  const hasTurns = (game.turnHistory?.length ?? 0) > 0;
  const [shareLabel, setShareLabel] = useState("Share Game");
  const shareLabelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (shareLabelTimerRef.current) clearTimeout(shareLabelTimerRef.current);
    };
  }, []);

  const handleShareGame = useCallback(async () => {
    const turns = game.turnHistory ?? [];
    const p1Name = game.player1Username;
    const p2Name = game.player2Username;
    const lines = ["SkateHubba Game Recap", `@${p1Name} vs @${p2Name}`, ""];

    for (const t of turns) {
      const outcome = t.landed ? `@${t.matcherUsername} landed` : `@${t.matcherUsername} missed`;
      lines.push(`Round ${t.turnNumber}: ${t.trickName} - Set by @${t.setterUsername}, ${outcome}`);
    }

    lines.push("");
    const p1Score = game.p1Letters > 0 ? LETTERS.slice(0, game.p1Letters).join(".") + "." : "-";
    const p2Score = game.p2Letters > 0 ? LETTERS.slice(0, game.p2Letters).join(".") + "." : "-";
    lines.push(`Final: @${p1Name} ${p1Score} | @${p2Name} ${p2Score}`);

    const winnerName = game.winner === game.player1Uid ? p1Name : p2Name;
    lines.push(game.status === "forfeit" ? `@${winnerName} wins by forfeit!` : `@${winnerName} wins!`);

    const text = lines.join("\n");

    if (navigator.share) {
      try {
        await navigator.share({ text });
        trackEvent("game_shared", { context: "archive" });
        return;
      } catch {
        // User cancelled or share failed — fall through to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      setShareLabel("Copied!");
      trackEvent("game_shared", { context: "archive", method: "clipboard" });
      shareLabelTimerRef.current = setTimeout(() => setShareLabel("Share Game"), 2000);
    } catch {
      setShareLabel("Copy failed");
      shareLabelTimerRef.current = setTimeout(() => setShareLabel("Share Game"), 2000);
    }
  }, [game]);

  return (
    <div
      className={`rounded-2xl overflow-hidden transition-all duration-300 ${
        expanded ? "glass-card border-brand-orange/25 shadow-glow-sm" : "glass-card"
      }`}
    >
      {/* Game summary row */}
      <button
        type="button"
        onClick={() => onToggle(game.id)}
        aria-expanded={expanded}
        className="w-full text-left p-4 flex items-center justify-between transition-colors hover:bg-[rgba(255,255,255,0.02)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-orange"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-display text-[17px] text-white leading-none truncate">
              vs @{opponentName(game, profileUid)}
            </span>
            <span
              className={`px-2 py-0.5 rounded font-display text-[10px] tracking-wider leading-none shrink-0 ${
                won ? "bg-[rgba(0,230,118,0.15)] text-brand-green" : "bg-[rgba(255,61,0,0.15)] text-brand-red"
              }`}
            >
              {won ? "WIN" : "LOSS"}
            </span>
            {game.status === "forfeit" && <span className="font-body text-[10px] text-subtle shrink-0">forfeit</span>}
          </div>
          {/* Score + date */}
          <div className="flex items-center gap-3">
            <LetterScore count={playerLetterCount(game, profileUid)} label="You" />
            <span className="font-body text-[10px] text-[#444]">vs</span>
            <LetterScore count={opponentLetterCount(game, profileUid)} label="Them" />
            {game.updatedAt && (
              <>
                <span className="text-[#2E2E2E]" aria-hidden="true">
                  ·
                </span>
                <span className="font-body text-[10px] text-subtle">{formatDate(game.updatedAt)}</span>
              </>
            )}
          </div>
        </div>
        <ChevronRightIcon
          size={14}
          className={`text-subtle shrink-0 ml-3 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
        />
      </button>

      {/* Expanded recap */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-border animate-fade-in">
          {hasTurns ? (
            <>
              <div className="mt-4">
                <GameReplay turns={game.turnHistory!} />
              </div>
              <TurnHistoryViewer
                turns={game.turnHistory!}
                currentUserUid={profileUid}
                defaultExpanded={false}
                showDownload={true}
                showShare={true}
              />
            </>
          ) : (
            <div className="flex flex-col items-center py-6">
              <p className="font-body text-xs text-subtle">
                {game.status === "forfeit" ? "Game ended by forfeit — no clips recorded" : "No clips available"}
              </p>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            {hasTurns && (
              <Btn onClick={handleShareGame} variant="secondary" className="!py-2.5 !text-sm flex-1">
                {shareLabel}
              </Btn>
            )}
            <Btn onClick={() => onOpenGame(game)} variant="ghost" className="!py-2.5 !text-sm flex-1">
              View Full Recap
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}
