import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { useLeaderboard } from "./leaderboard/useLeaderboard";
import { LeaderboardPodium } from "./leaderboard/LeaderboardPodium";
import { LeaderboardRow } from "./leaderboard/LeaderboardRow";

/**
 * True while `node` is scrolled out of view below the fold. Drives the
 * pinned "You" row; an unmounted node counts as visible.
 */
function useBelowViewport(node: HTMLElement | null): boolean {
  const [below, setBelow] = useState(false);
  useEffect(() => {
    if (!node) return;
    const io = new IntersectionObserver(([entry]) => {
      setBelow(!entry.isIntersecting && entry.boundingClientRect.top > 0);
    });
    io.observe(node);
    return () => io.disconnect();
  }, [node]);
  return below;
}

/**
 * Leaderboard (audit #10): a top-three podium, then labelled rows (rank,
 * avatar, handle, record and win rate). Each row opens the profile, where
 * Challenge lives. Your row is highlighted, and pinned to the bottom while
 * it is scrolled out of view.
 */
export function Leaderboard({
  currentUserUid,
  onViewPlayer,
}: {
  currentUserUid: string;
  onViewPlayer?: (uid: string) => void;
}) {
  const { players, loading, error, retry } = useLeaderboard(currentUserUid);
  const [youNode, setYouNode] = useState<HTMLLIElement | null>(null);
  const youBelow = useBelowViewport(youNode);

  if (loading) {
    return (
      <p role="status" className="my-6 text-center font-body text-sm text-muted">
        Loading leaderboard…
      </p>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="my-6 flex flex-col items-center rounded-2xl border border-border bg-surface px-4 py-8"
      >
        <p className="font-body text-sm text-white">{error}</p>
        <button
          type="button"
          onClick={retry}
          className="btn-secondary mt-3 min-h-11 rounded-xl px-5 font-body text-sm font-semibold"
        >
          Try again
        </button>
      </div>
    );
  }

  if (players.length === 0) {
    return (
      <div className="my-6 flex flex-col items-center rounded-2xl border border-dashed border-border px-4 py-8 text-center">
        <Trophy size={28} aria-hidden="true" className="mb-2 text-subtle" />
        <p className="font-body text-sm font-semibold text-white">No ranked skaters yet</p>
        <p className="mt-1 font-body text-xs text-muted">Finish a game to get on the board.</p>
      </div>
    );
  }

  const podium = players.length >= 3 ? players.slice(0, 3) : [];
  const rest = players.slice(podium.length);
  const youIndex = players.findIndex((p) => p.uid === currentUserUid);
  const youInList = youIndex >= podium.length;

  return (
    <section aria-labelledby="leaderboard-title" className="my-6">
      <h2 id="leaderboard-title" className="sr-only">
        Leaderboard
      </h2>
      {podium.length > 0 && <LeaderboardPodium top={podium} viewerUid={currentUserUid} onViewPlayer={onViewPlayer} />}
      <ol aria-label={podium.length > 0 ? "Everyone else" : "Rankings"} className="space-y-2">
        {rest.map((p, i) => {
          const isYou = p.uid === currentUserUid;
          return (
            <LeaderboardRow
              key={p.uid}
              ref={isYou ? setYouNode : undefined}
              player={p}
              rank={podium.length + i + 1}
              isYou={isYou}
              onViewPlayer={onViewPlayer}
            />
          );
        })}
      </ol>
      {youInList && youBelow && (
        <ul
          aria-label="Your rank"
          className="sticky bottom-[calc(var(--tabbar-h)+max(env(safe-area-inset-bottom),0.75rem))] mt-2"
        >
          <LeaderboardRow player={players[youIndex]} rank={youIndex + 1} isYou pinned onViewPlayer={onViewPlayer} />
        </ul>
      )}
    </section>
  );
}
