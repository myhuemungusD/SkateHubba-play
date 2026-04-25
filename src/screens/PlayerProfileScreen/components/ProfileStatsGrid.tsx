import type { ProfileStats } from "../usePlayerProfileController";
import { StatCard } from "./StatCard";

interface Props {
  stats: ProfileStats;
  isOwnProfile: boolean;
  hasCompletedGames: boolean;
}

export function ProfileStatsGrid({ stats, isOwnProfile, hasCompletedGames }: Props) {
  return (
    <>
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

      {!isOwnProfile && hasCompletedGames && (
        <>
          <p className="font-display text-[10px] tracking-[0.2em] text-brand-orange mb-2.5 animate-fade-in">VS YOU</p>
          <div className="grid grid-cols-3 gap-2.5 mb-8 animate-fade-in">
            <StatCard label="Your Wins" value={stats.vsYouWins} color="text-brand-green" />
            <StatCard label="Your Losses" value={stats.vsYouLosses} color="text-brand-red" />
            <StatCard label="Games" value={stats.vsYouTotal} color="text-white" />
          </div>
        </>
      )}
    </>
  );
}
