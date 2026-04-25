import type { usePlayerDirectory } from "../../../hooks/usePlayerDirectory";
import { ProUsername } from "../../../components/ProUsername";

type Player = ReturnType<typeof usePlayerDirectory>["players"][number];

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
  if (ms < 0) return "Just joined";
  const hours = ms / 3_600_000;
  if (hours < 1) return "Just joined";
  if (hours < 24) return `Joined ${Math.floor(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Joined ${days}d ago`;
  const d = new Date(millis);
  const month = d.toLocaleString("en-US", { month: "short" });
  return `Joined ${month} ${d.getDate()}`;
}

interface Props {
  players: Player[];
  loading: boolean;
  user: { emailVerified?: boolean } | null;
  onViewPlayer?: (uid: string) => void;
  onChallengeUser: (username: string) => void;
}

export function PlayerDirectory({ players, loading, user, onViewPlayer, onChallengeUser }: Props) {
  if (loading) {
    return (
      <div className="mb-6" role="status" aria-busy="true" aria-label="Loading skaters">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">SKATERS</h3>
        </div>
        <div className="space-y-2 animate-pulse">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between p-4 rounded-2xl bg-surface-alt/60 border border-border"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full bg-surface-alt border border-border shrink-0" />
                <div className="space-y-2">
                  <div className="h-4 w-28 rounded-md bg-surface-alt" />
                  <div className="h-3 w-20 rounded-md bg-surface-alt/70" />
                </div>
              </div>
              <div className="h-9 w-20 rounded-lg bg-surface-alt" />
            </div>
          ))}
        </div>
        <span className="sr-only">Loading skaters…</span>
      </div>
    );
  }

  if (players.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">SKATERS</h3>
        <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
          {players.length}
        </span>
      </div>
      <div className="space-y-2">
        {players.map((p: Player) => (
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
                  {p.createdAt ? ` · ${relativeJoinDate(p.createdAt)}` : ""}
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
  );
}
