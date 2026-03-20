import { useState, useMemo } from "react";
import type { GameDoc } from "../services/games";
import type { UserProfile } from "../services/users";
import { LETTERS } from "../utils/helpers";
import { TurnHistoryViewer } from "../components/TurnHistoryViewer";
import { GameReplay } from "../components/GameReplay";
import { Btn } from "../components/ui/Btn";
import { TrophyIcon, SkullIcon, FlameIcon } from "../components/icons";

/* ── Helpers ──────────────────────────────────────────── */

interface OpponentRecord {
  uid: string;
  username: string;
  wins: number;
  losses: number;
  games: GameDoc[];
}

function relativeDate(ts: { toMillis?: () => number } | null): string {
  if (!ts || typeof ts.toMillis !== "function") return "";
  const d = new Date(ts.toMillis());
  const month = d.toLocaleString("en-US", { month: "short" });
  return `${month} ${d.getDate()}`;
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
    let forfeitsWon = 0;
    let forfeitsLost = 0;
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
        if (g.status === "forfeit") forfeitsWon++;
      } else {
        losses++;
        currentStreak = 0;
        if (g.status === "forfeit") forfeitsLost++;
      }

      for (const t of g.turnHistory ?? []) {
        totalTricks++;
        if (t.landed) tricksLanded++;
      }
    }

    const total = wins + losses;
    const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
    const landRate = totalTricks > 0 ? Math.round((tricksLanded / totalTricks) * 100) : 0;

    return { wins, losses, total, winRate, forfeitsWon, forfeitsLost, totalTricks, tricksLanded, landRate, longestStreak, currentStreak };
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
        rec = { uid: oppUid, username: oppName, wins: 0, losses: 0, games: [] };
        map.set(oppUid, rec);
      }
      if (won) rec.wins++;
      else rec.losses++;
      rec.games.push(g);
    }

    return Array.from(map.values()).sort((a, b) => {
      const aTotal = a.wins + a.losses;
      const bTotal = b.wins + b.losses;
      return bTotal - aTotal;
    });
  }, [completedGames, profile.uid]);

  const opponent = (g: GameDoc) => (g.player1Uid === profile.uid ? g.player2Username : g.player1Username);
  const myLetters = (g: GameDoc) => (g.player1Uid === profile.uid ? g.p1Letters : g.p2Letters);
  const theirLetters = (g: GameDoc) => (g.player1Uid === profile.uid ? g.p2Letters : g.p1Letters);

  return (
    <div className="min-h-dvh bg-[#0A0A0A]/60 pb-24">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex justify-between items-center border-b border-border">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-[#888] hover:text-white transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span className="font-body text-xs">Lobby</span>
        </button>
        <span className="font-display text-sm tracking-[0.25em] text-brand-orange">MY RECORD</span>
        <div className="w-16" /> {/* spacer for centering */}
      </div>

      <div className="px-5 pt-7 max-w-lg mx-auto">
        {/* Player identity */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-full bg-surface-alt border border-border flex items-center justify-center shrink-0">
            <span className="font-display text-lg text-brand-orange leading-none">
              {profile.username[0].toUpperCase()}
            </span>
          </div>
          <div>
            <h1 className="font-display text-2xl text-white leading-none">@{profile.username}</h1>
            <p className="font-body text-xs text-[#888] mt-1">{profile.stance}</p>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-2 mb-6">
          <StatCard label="Wins" value={stats.wins} color="text-brand-green" />
          <StatCard label="Losses" value={stats.losses} color="text-brand-red" />
          <StatCard label="Win Rate" value={`${stats.winRate}%`} color="text-brand-orange" />
        </div>

        <div className="grid grid-cols-3 gap-2 mb-8">
          <StatCard label="Games" value={stats.total} color="text-white" />
          <StatCard label="Best Streak" value={stats.longestStreak} color="text-brand-orange" />
          <StatCard label="Land Rate" value={`${stats.landRate}%`} color="text-brand-green" />
        </div>

        {/* Current streak callout */}
        {stats.currentStreak >= 2 && (
          <div className="flex items-center justify-center gap-2 mb-8 px-4 py-3 rounded-xl border border-[rgba(255,107,0,0.3)] bg-[rgba(255,107,0,0.05)]">
            <FlameIcon size={18} className="text-brand-orange" />
            <span className="font-display text-sm tracking-wider text-brand-orange">
              {stats.currentStreak} WIN STREAK
            </span>
          </div>
        )}

        {/* Opponents section */}
        {opponents.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">OPPONENTS</h3>
              <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
                {opponents.length}
              </span>
            </div>
            <div className="space-y-2">
              {opponents.map((opp) => {
                const total = opp.wins + opp.losses;
                return (
                  <div
                    key={opp.uid}
                    className="flex items-center justify-between p-4 rounded-2xl bg-surface border border-border"
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
                          <span className="font-body text-[11px] text-[#666]">{total} {total === 1 ? "game" : "games"}</span>
                        </div>
                      </div>
                    </div>
                    {/* H2H indicator */}
                    <div className="shrink-0 ml-3">
                      {opp.wins > opp.losses ? (
                        <TrophyIcon size={16} className="text-brand-green" />
                      ) : opp.wins < opp.losses ? (
                        <SkullIcon size={16} className="text-brand-red" />
                      ) : (
                        <span className="font-display text-xs text-[#666]">EVEN</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Game history */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">GAME HISTORY</h3>
            <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
              {completedGames.length}
            </span>
          </div>

          {completedGames.length === 0 ? (
            <div className="flex flex-col items-center py-10 border border-dashed border-border rounded-2xl">
              <TrophyIcon size={24} className="mb-2 opacity-40 text-[#555]" />
              <p className="font-body text-xs text-[#666]">No games played yet</p>
              <p className="font-body text-[11px] text-[#555] mt-0.5">Complete a game to see it here</p>
            </div>
          ) : (
            <div className="space-y-2">
              {completedGames.map((g) => {
                const won = g.winner === profile.uid;
                const hasTurns = (g.turnHistory?.length ?? 0) > 0;
                const isExpanded = expandedGameId === g.id;

                return (
                  <div key={g.id} className="rounded-2xl bg-surface border border-border overflow-hidden">
                    {/* Game summary row */}
                    <button
                      type="button"
                      onClick={() => setExpandedGameId(isExpanded ? null : g.id)}
                      className="w-full text-left p-4 flex items-center justify-between transition-colors hover:bg-[rgba(255,255,255,0.02)]"
                    >
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-display text-[17px] text-white leading-none">
                            vs @{opponent(g)}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded font-display text-[10px] tracking-wider leading-none ${
                              won
                                ? "bg-[rgba(0,230,118,0.15)] text-brand-green"
                                : "bg-[rgba(255,61,0,0.15)] text-brand-red"
                            }`}
                          >
                            {won ? "W" : "L"}
                          </span>
                          {g.status === "forfeit" && (
                            <span className="font-body text-[10px] text-[#666]">forfeit</span>
                          )}
                        </div>
                        {/* Score + date */}
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1">
                            {LETTERS.map((l, i) => (
                              <span
                                key={i}
                                className={`font-display text-[11px] leading-none ${i < myLetters(g) ? "text-brand-red" : "text-[#333]"}`}
                              >
                                {l}
                              </span>
                            ))}
                          </div>
                          <span className="font-body text-[10px] text-[#555]">vs</span>
                          <div className="flex items-center gap-1">
                            {LETTERS.map((l, i) => (
                              <span
                                key={i}
                                className={`font-display text-[11px] leading-none ${i < theirLetters(g) ? "text-brand-red" : "text-[#333]"}`}
                              >
                                {l}
                              </span>
                            ))}
                          </div>
                          {g.updatedAt && (
                            <>
                              <span className="text-[#333]">·</span>
                              <span className="font-body text-[10px] text-[#555]">{relativeDate(g.updatedAt)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <svg
                        className={`text-[#555] shrink-0 ml-3 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>

                    {/* Expanded recap */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-0 border-t border-border animate-fade-in">
                        {hasTurns ? (
                          <>
                            <div className="mt-4">
                              <GameReplay turns={g.turnHistory!} />
                            </div>
                            <TurnHistoryViewer
                              turns={g.turnHistory!}
                              currentUserUid={profile.uid}
                              defaultExpanded={false}
                              showDownload={true}
                            />
                          </>
                        ) : (
                          <p className="font-body text-xs text-[#666] py-4 text-center">
                            {g.status === "forfeit" ? "Game ended by forfeit — no clips recorded" : "No clips available"}
                          </p>
                        )}

                        <div className="mt-4">
                          <Btn
                            onClick={() => onOpenGame(g)}
                            variant="ghost"
                            className="!py-2.5 !text-sm"
                          >
                            Full Recap
                          </Btn>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Stat card ────────────────────────────────────────── */

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="flex flex-col items-center py-3 px-2 rounded-xl border border-border bg-surface">
      <span className={`font-display text-xl leading-none tabular-nums ${color}`}>{value}</span>
      <span className="font-body text-[10px] text-[#666] mt-1.5 uppercase tracking-wider">{label}</span>
    </div>
  );
}
