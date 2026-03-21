import { useState, useMemo, useCallback } from "react";
import type { GameDoc } from "../services/games";
import type { UserProfile } from "../services/users";
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

/* ── Types ────────────────────────────────────────────── */

interface OpponentRecord {
  uid: string;
  username: string;
  wins: number;
  losses: number;
  totalGames: number;
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

function myLetterCount(g: GameDoc, uid: string): number {
  return g.player1Uid === uid ? g.p1Letters : g.p2Letters;
}

function theirLetterCount(g: GameDoc, uid: string): number {
  return g.player1Uid === uid ? g.p2Letters : g.p1Letters;
}

/* ── Component ────────────────────────────────────────── */

export function MyRecordScreen({
  profile,
  games,
  onOpenGame,
  onBack,
}: {
  profile: UserProfile;
  games: GameDoc[];
  onOpenGame: (g: GameDoc) => void;
  onBack: () => void;
}) {
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);

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
    let wins = 0;
    let losses = 0;
    let totalTricks = 0;
    let tricksLanded = 0;
    let longestStreak = 0;
    let currentStreak = 0;

    // Process in chronological order for streak calculation
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

    const total = wins + losses;
    const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
    const landRate = totalTricks > 0 ? Math.round((tricksLanded / totalTricks) * 100) : 0;

    return { wins, losses, total, winRate, totalTricks, tricksLanded, landRate, longestStreak, currentStreak };
  }, [completedGames, profile.uid]);

  // Opponent head-to-head records
  const opponents = useMemo(() => {
    const map = new Map<string, OpponentRecord>();

    for (const g of completedGames) {
      const isP1 = g.player1Uid === profile.uid;
      const oppUid = isP1 ? g.player2Uid : g.player1Uid;
      const oppName = isP1 ? g.player2Username : g.player1Username;
      const won = g.winner === profile.uid;

      let rec = map.get(oppUid);
      if (!rec) {
        rec = { uid: oppUid, username: oppName, wins: 0, losses: 0, totalGames: 0 };
        map.set(oppUid, rec);
      }
      if (won) rec.wins++;
      else rec.losses++;
      rec.totalGames++;
    }

    return Array.from(map.values()).sort((a, b) => b.totalGames - a.totalGames);
  }, [completedGames, profile.uid]);

  return (
    <div
      className="min-h-dvh pb-24 overflow-y-auto"
      style={{
        background: "radial-gradient(ellipse at 50% 0%, rgba(255,107,0,0.06) 0%, transparent 50%), rgba(10,10,10,0.8)",
      }}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex justify-between items-center border-b border-white/[0.04] glass">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-muted hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange rounded-lg"
          aria-label="Back to lobby"
        >
          <ChevronLeftIcon size={16} />
          <span className="font-body text-xs">Lobby</span>
        </button>
        <span className="font-display text-sm tracking-[0.25em] text-brand-orange">MY RECORD</span>
        {/* Spacer to center title */}
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
            <h1 className="font-display text-3xl text-white leading-none tracking-wide">@{profile.username}</h1>
            <p className="font-body text-xs text-muted mt-1.5 capitalize">{profile.stance}</p>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-2.5 mb-2.5 animate-fade-in">
          <StatCard label="Wins" value={stats.wins} color="text-brand-green" />
          <StatCard label="Losses" value={stats.losses} color="text-brand-red" />
          <StatCard
            label="Win Rate"
            value={`${stats.winRate}%`}
            color={stats.winRate >= 50 ? "text-brand-orange" : "text-muted"}
          />
        </div>

        <div className="grid grid-cols-3 gap-2.5 mb-8 animate-fade-in">
          <StatCard label="Games" value={stats.total} color="text-white" />
          <StatCard label="Best Streak" value={stats.longestStreak} color="text-brand-orange" />
          <StatCard
            label="Land Rate"
            value={`${stats.landRate}%`}
            color={stats.landRate >= 50 ? "text-brand-green" : "text-muted"}
          />
        </div>

        {/* Current streak callout */}
        {stats.currentStreak >= 2 && (
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

        {/* Opponents section */}
        {opponents.length > 0 && (
          <div className="mb-8 animate-fade-in">
            <SectionHeader title="OPPONENTS" count={opponents.length} />
            <div className="space-y-2">
              {opponents.map((opp) => (
                <div
                  key={opp.uid}
                  className="flex items-center justify-between p-4 rounded-2xl glass-card transition-all duration-300"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-surface-alt border border-border flex items-center justify-center shrink-0">
                      <span className="font-display text-[11px] text-brand-orange leading-none">
                        {opp.username[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="font-display text-base text-white block leading-none truncate">
                        @{opp.username}
                      </span>
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
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Game history */}
        <div className="mb-6 animate-fade-in">
          <SectionHeader title="GAME HISTORY" count={completedGames.length} />

          {completedGames.length === 0 ? (
            <div className="flex flex-col items-center py-14 border border-dashed border-border rounded-2xl">
              <SkateboardIcon size={28} className="mb-3 opacity-30 text-subtle" />
              <p className="font-body text-sm text-faint">No games played yet</p>
              <p className="font-body text-[11px] text-subtle mt-1">
                Challenge someone and finish a game to build your record
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
    <div className="flex flex-col items-center py-3.5 px-2 rounded-xl glass-card">
      <span className={`font-display text-2xl leading-none tabular-nums ${color}`}>{value}</span>
      <span className="font-body text-[10px] text-subtle mt-2 uppercase tracking-wider">{label}</span>
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
      setTimeout(() => setShareLabel("Share Game"), 2000);
    } catch {
      // Clipboard not available
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
            <LetterScore count={myLetterCount(game, profileUid)} label="You" />
            <span className="font-body text-[10px] text-[#444]">vs</span>
            <LetterScore count={theirLetterCount(game, profileUid)} label="Them" />
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
