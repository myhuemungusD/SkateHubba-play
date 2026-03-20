/**
 * ProfileStats — compact W/L/streak display
 * Rendered on both self and opponent profiles.
 * Data comes from the embedded stats object on the user doc.
 */

import type { PlayerStats } from '../../types/profile';
import { winRate } from '../../lib/profile-operations';

interface ProfileStatsProps {
  stats: PlayerStats;
}

const SKATE_LETTERS = ['S', 'K', 'A', 'T', 'E'] as const;

export function ProfileStats({ stats }: ProfileStatsProps) {
  const rate = winRate(stats);
  const totalGames = stats.wins + stats.losses + stats.forfeits;

  return (
    <div className="grid grid-cols-4 gap-3">
      <StatBlock label="Record" value={`${stats.wins}–${stats.losses}`} />
      <StatBlock label="Win %" value={totalGames > 0 ? `${rate}%` : '—'} />
      <StatBlock label="Streak" value={stats.currentStreak > 0 ? `${stats.currentStreak}🔥` : '0'} />
      <StatBlock label="Best" value={String(stats.bestStreak)} />
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-neutral-900 px-3 py-3">
      <span className="text-lg font-bold text-white">{value}</span>
      <span className="mt-0.5 text-xs uppercase tracking-wider text-neutral-500">
        {label}
      </span>
    </div>
  );
}

/** Visual S.K.A.T.E. letter indicator for in-game contexts */
export function LetterIndicator({ letters }: { letters: number }) {
  return (
    <div className="flex gap-1.5">
      {SKATE_LETTERS.map((letter, i) => (
        <span
          key={letter}
          className={`text-sm font-bold ${
            i < letters ? 'text-orange-500' : 'text-neutral-700'
          }`}
        >
          {letter}
        </span>
      ))}
    </div>
  );
}
