/** One trick in the library: name, difficulty, notes, optional clip, and votes. */
import { useEffect, useState, type ReactNode } from "react";
import type { TrickLibraryEntry, TrickScore, TrickVoteValue } from "../types/trickLibrary";
import { clearTrickVote, getMyTrickVote, getTrickScore, voteTrick } from "../services/trickLibrary";
import { logger } from "../services/logger";

const DIFFICULTY_COLOR: Record<TrickLibraryEntry["difficulty"], string> = {
  beginner: "text-brand-green",
  intermediate: "text-yellow-400",
  advanced: "text-brand-orange",
  expert: "text-brand-red",
};

interface Props {
  trick: TrickLibraryEntry;
  uid: string;
  /** Voting only applies to approved tricks. */
  canVote: boolean;
  /** Extra controls (status chip, moderation buttons). */
  footer?: ReactNode;
}

export function TrickCard({ trick, uid, canVote, footer }: Props) {
  const [myVote, setMyVote] = useState<TrickVoteValue | null>(null);
  const [score, setScore] = useState<TrickScore>({ up: 0, down: 0 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canVote) return;
    let live = true;
    Promise.all([getMyTrickVote(uid, trick.id), getTrickScore(trick.id)])
      .then(([vote, s]) => {
        if (!live) return;
        setMyVote(vote);
        setScore(s);
      })
      .catch((err: unknown) => logger.warn("trick_votes_read_failed", { trickId: trick.id, error: String(err) }));
    return () => {
      live = false;
    };
  }, [canVote, uid, trick.id]);

  const vote = async (value: TrickVoteValue) => {
    if (busy) return;
    setBusy(true);
    const before = myVote;
    const next = before === value ? null : value;
    try {
      if (next) await voteTrick(uid, trick.id, next);
      else await clearTrickVote(uid, trick.id);
      setMyVote(next);
      setScore((s) => ({
        up: s.up + (next === "up" ? 1 : 0) - (before === "up" ? 1 : 0),
        down: s.down + (next === "down" ? 1 : 0) - (before === "down" ? 1 : 0),
      }));
    } catch (err) {
      logger.warn("trick_vote_failed", { trickId: trick.id, error: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const voteBtn = (value: TrickVoteValue, label: string, count: number) => (
    <button
      type="button"
      onClick={() => void vote(value)}
      disabled={busy}
      aria-pressed={myVote === value}
      aria-label={`${label} (${count})`}
      className={`touch-target rounded-xl border px-3 py-1.5 font-display text-sm tracking-wider transition-colors disabled:opacity-40 ${
        myVote === value ? "border-brand-orange text-brand-orange" : "border-border text-muted hover:text-white"
      }`}
    >
      {label} {count}
    </button>
  );

  return (
    <article className="glass-card rounded-2xl p-4" aria-label={trick.name}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-lg tracking-wider text-white">{trick.name}</h3>
        <span className={`font-display text-xs uppercase tracking-wider ${DIFFICULTY_COLOR[trick.difficulty]}`}>
          {trick.difficulty}
        </span>
      </div>
      {trick.description && <p className="mb-3 font-body text-sm text-dim">{trick.description}</p>}
      {trick.videoUrl && (
        <video src={trick.videoUrl} controls playsInline preload="metadata" className="mb-3 w-full rounded-xl" />
      )}
      {canVote && (
        <div className="flex items-center gap-2">
          {voteBtn("up", "Up", score.up)}
          {voteBtn("down", "Down", score.down)}
        </div>
      )}
      {footer}
    </article>
  );
}
