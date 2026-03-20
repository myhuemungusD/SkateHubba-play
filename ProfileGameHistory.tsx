/**
 * ProfileGameHistory — recent completed games
 * Real-time listener via onSnapshot. Shows opponent, result, and date.
 * Tapping a game could navigate to game detail (future scope).
 */

import { useEffect, useState } from 'react';
import { subscribeToGameHistory } from '../../lib/profile-operations';
import { LetterIndicator } from './ProfileStats';
import type { GameSummary } from '../../types/profile';

interface ProfileGameHistoryProps {
  uid: string;
}

export function ProfileGameHistory({ uid }: ProfileGameHistoryProps) {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const unsub = subscribeToGameHistory(
      uid,
      (data) => {
        setGames(data);
        setLoading(false);
      },
      (err) => {
        console.error('[ProfileGameHistory] snapshot error:', err);
        setError('Failed to load game history');
        setLoading(false);
      }
    );

    return unsub;
  }, [uid]);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-lg bg-neutral-900"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-lg bg-red-950/30 px-4 py-3 text-sm text-red-400">
        {error}
      </p>
    );
  }

  if (games.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-neutral-500">
        No completed games yet. Challenge someone!
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {games.map((game) => (
        <GameRow key={game.id} game={game} />
      ))}
    </div>
  );
}

function GameRow({ game }: { game: GameSummary }) {
  const resultConfig = RESULT_STYLES[game.result];
  const timeAgo = formatRelativeTime(game.completedAt);

  return (
    <div className="flex items-center gap-3 rounded-lg bg-neutral-900 px-4 py-3">
      {/* Opponent avatar */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-800">
        {game.opponentPhotoURL ? (
          <img
            src={game.opponentPhotoURL}
            alt={game.opponentDisplayName}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          <span className="text-sm font-bold text-neutral-500">
            {game.opponentDisplayName.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      {/* Opponent info + letters */}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-white">
          @{game.opponentUsername}
        </span>
        <div className="mt-1 flex items-center gap-3">
          <LetterIndicator letters={game.myLetters} />
          <span className="text-xs text-neutral-600">vs</span>
          <LetterIndicator letters={game.opponentLetters} />
        </div>
      </div>

      {/* Result + time */}
      <div className="flex shrink-0 flex-col items-end">
        <span className={`text-xs font-bold uppercase ${resultConfig.color}`}>
          {resultConfig.label}
        </span>
        <span className="mt-0.5 text-xs text-neutral-600">{timeAgo}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESULT_STYLES = {
  win: { label: 'W', color: 'text-green-500' },
  loss: { label: 'L', color: 'text-red-500' },
  forfeit: { label: 'FF', color: 'text-neutral-500' },
} as const;

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
