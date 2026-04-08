import { useState, useEffect } from "react";
import { getLeaderboard, type UserProfile } from "../services/users";
import { getBlockedUserIds } from "../services/blocking";
import { ProUsername } from "./ProUsername";

const RANK_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32"] as const; // gold, silver, bronze

export function Leaderboard({
  currentUserUid,
  onChallengeUser,
  onViewPlayer,
}: {
  currentUserUid: string;
  onChallengeUser?: (username: string) => void;
  onViewPlayer?: (uid: string) => void;
}) {
  const [players, setPlayers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let stale = false;
    Promise.all([getLeaderboard(), getBlockedUserIds(currentUserUid)])
      .then(([all, blockedIds]) => {
        if (!stale) setPlayers(all.filter((p) => !blockedIds.has(p.uid)));
      })
      .catch(() => {
        if (!stale) setError("Could not load leaderboard");
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [currentUserUid]);

  if (loading) {
    return <p className="font-body text-xs text-brand-orange text-center my-6">Loading leaderboard...</p>;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-8 border border-dashed border-border rounded-2xl my-6">
        <p className="font-body text-xs text-brand-red">{error}</p>
        <button
          type="button"
          onClick={() => {
            setError("");
            setLoading(true);
            getLeaderboard()
              .then(setPlayers)
              .catch(() => setError("Could not load leaderboard"))
              .finally(() => setLoading(false));
          }}
          className="font-body text-xs text-brand-orange mt-2 underline underline-offset-2"
        >
          Retry
        </button>
      </div>
    );
  }

  // Filter to players who have at least one game played
  const ranked = players.filter((p) => (p.wins ?? 0) + (p.losses ?? 0) > 0);

  if (ranked.length === 0) {
    return (
      <div className="my-6">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">LEADERBOARD</h3>
        </div>
        <div className="flex flex-col items-center py-8 border border-dashed border-border rounded-2xl">
          <span className="text-2xl mb-2 opacity-40" aria-hidden="true">
            🏆
          </span>
          <p className="font-body text-xs text-[#666]">No ranked players yet</p>
          <p className="font-body text-[11px] text-[#555] mt-0.5">Complete a game to appear on the leaderboard</p>
        </div>
      </div>
    );
  }

  const currentUserRank = ranked.findIndex((p) => p.uid === currentUserUid);

  return (
    <div className="my-6">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">LEADERBOARD</h3>
        <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
          {ranked.length}
        </span>
      </div>
      <div className="space-y-2">
        {ranked.map((p, i) => {
          const isCurrentUser = p.uid === currentUserUid;
          const wins = p.wins ?? 0;
          const losses = p.losses ?? 0;
          const total = wins + losses;
          const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
          const rankColor = i < 3 ? RANK_COLORS[i] : undefined;

          return (
            <div
              key={p.uid}
              className={`flex items-center justify-between p-4 rounded-2xl transition-all duration-300 ${
                isCurrentUser
                  ? "glass-card border-brand-orange/30 shadow-glow-sm"
                  : "bg-surface border border-border hover:border-border-hover"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                {/* Rank */}
                <span
                  className="font-display text-[15px] w-6 text-center shrink-0 leading-none tabular-nums"
                  style={rankColor ? { color: rankColor } : undefined}
                >
                  {rankColor ? (
                    <span className="drop-shadow-[0_0_4px_rgba(255,215,0,0.3)]">{i + 1}</span>
                  ) : (
                    <span className="text-[#555]">{i + 1}</span>
                  )}
                </span>

                {/* Avatar */}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    isCurrentUser
                      ? "bg-brand-orange/20 border border-brand-orange/40"
                      : "bg-surface-alt border border-border"
                  }`}
                >
                  <span
                    className={`font-display text-[11px] leading-none ${isCurrentUser ? "text-brand-orange" : "text-brand-orange"}`}
                  >
                    {p.username[0].toUpperCase()}
                  </span>
                </div>

                {/* Name + stats */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {onViewPlayer ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewPlayer(p.uid);
                        }}
                        className="font-display text-base text-white leading-none truncate hover:text-brand-orange transition-colors"
                      >
                        <ProUsername username={p.username} isVerifiedPro={p.isVerifiedPro} />
                      </button>
                    ) : (
                      <ProUsername
                        username={p.username}
                        isVerifiedPro={p.isVerifiedPro}
                        className="font-display text-base text-white leading-none truncate"
                      />
                    )}
                    {isCurrentUser && (
                      <span className="px-1.5 py-0.5 rounded bg-brand-orange font-display text-[9px] text-white tracking-wider leading-none shrink-0">
                        YOU
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-body text-[11px] text-brand-green">{wins}W</span>
                    <span className="font-body text-[11px] text-brand-red">{losses}L</span>
                    <span className="font-body text-[11px] text-[#666]">{winRate}%</span>
                  </div>
                </div>
              </div>

              {/* Challenge action */}
              {!isCurrentUser && onChallengeUser && (
                <button
                  type="button"
                  onClick={() => onChallengeUser(p.username)}
                  className="font-display text-xs text-brand-orange shrink-0 ml-3 hover:text-[#FF7A1A] transition-colors"
                >
                  Challenge &rarr;
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Show current user's rank if they're not in the visible list or for quick reference */}
      {currentUserRank >= 0 && ranked.length > 5 && (
        <p className="font-body text-[11px] text-[#888] text-center mt-3">
          You are ranked <span className="text-brand-orange font-display">#{currentUserRank + 1}</span> of{" "}
          {ranked.length}
        </p>
      )}
    </div>
  );
}
