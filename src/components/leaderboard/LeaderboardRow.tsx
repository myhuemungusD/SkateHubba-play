import { forwardRef } from "react";
import { ChevronRight } from "lucide-react";
import type { UserProfile } from "../../services/users";
import { ratedWinRate, totalGames, MIN_RATED_GAMES } from "../../constants/stats";
import { ProUsername } from "../ProUsername";
import { RecordFigure } from "../RecordFigure";

/** Gold, silver, bronze as literal utilities so the CSP can drop 'unsafe-inline' styles. */
export const MEDAL_TEXT = ["text-[#FFD700]", "text-[#C0C0C0]", "text-[#CD7F32]"] as const;

/** "4 / 6 won · 67% win rate", or "· rated after 5 games" while provisional. Every figure is labelled. */
export function LeaderboardStat({ player, className = "" }: { player: UserProfile; className?: string }) {
  const games = totalGames(player.wins, player.losses);
  const rate = ratedWinRate(player.wins, player.losses);
  return (
    <span className={`font-body text-xs text-muted ${className}`}>
      <RecordFigure wins={player.wins} games={games} caption="won" className="text-white/80" />
      {" · "}
      {rate === null ? `rated after ${MIN_RATED_GAMES} games` : `${rate}% win rate`}
    </span>
  );
}

export function PlayerInitial({
  player,
  isYou,
  size = "h-10 w-10",
}: {
  player: UserProfile;
  isYou: boolean;
  size?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`${size} inline-flex shrink-0 items-center justify-center rounded-full border font-display text-base leading-none ${
        isYou
          ? "border-brand-orange/50 bg-brand-orange/15 text-brand-orange"
          : "border-border bg-surface-alt text-white/80"
      }`}
    >
      {player.username[0]?.toUpperCase()}
    </span>
  );
}

interface RowProps {
  player: UserProfile;
  rank: number;
  isYou: boolean;
  onViewPlayer?: (uid: string) => void;
  /** The pinned copy of your row at the bottom of the list. */
  pinned?: boolean;
}

/** Rank, avatar, handle and labelled record. The whole row opens the profile, where Challenge lives. */
export const LeaderboardRow = forwardRef<HTMLLIElement, RowProps>(function LeaderboardRow(
  { player, rank, isYou, onViewPlayer, pinned = false },
  ref,
) {
  const medal = rank <= 3 ? MEDAL_TEXT[rank - 1] : "text-subtle";
  const body = (
    <>
      <span className={`w-7 shrink-0 text-center font-display text-lg leading-none tabular-nums ${medal}`}>
        <span className="sr-only">Rank </span>
        {rank}
      </span>
      <PlayerInitial player={player} isYou={isYou} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <ProUsername
            username={player.username}
            isVerifiedPro={player.isVerifiedPro}
            className="truncate font-body text-sm font-semibold text-white"
          />
          {isYou && (
            <span className="rounded bg-brand-orange px-1.5 py-0.5 font-body text-caption font-semibold leading-none text-black">
              You
            </span>
          )}
        </span>
        <LeaderboardStat player={player} className="mt-1 block truncate" />
      </span>
    </>
  );
  const frame = `flex min-h-[64px] w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left ${
    isYou ? "border-brand-orange/40 bg-surface-alt" : "border-border bg-surface"
  } ${pinned ? "shadow-lg" : ""}`;

  return (
    <li ref={ref} data-testid={pinned ? "leaderboard-you-pinned" : undefined}>
      {onViewPlayer ? (
        <button
          type="button"
          onClick={() => onViewPlayer(player.uid)}
          className={`${frame} transition-colors hover:border-border-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange`}
        >
          {body}
          <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-subtle" />
        </button>
      ) : (
        <div className={frame}>{body}</div>
      )}
    </li>
  );
});
