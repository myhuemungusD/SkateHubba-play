import { formatRecord } from "../../../constants/stats";
import { RecordFigure } from "../../../components/RecordFigure";
import { useState } from "react";
import type { GameDoc } from "../../../services/games";
import { ProUsername } from "../../../components/ProUsername";
import type { RecentOpponent } from "../recentOpponents";

interface Props {
  opponents: RecentOpponent[];
  /** Starts a new game against this skater. Undefined while the viewer can't challenge (unverified). */
  onRematch?: (uid: string, username: string) => Promise<void>;
  onOpenGame: (g: GameDoc) => void;
  onViewPlayer?: (uid: string) => void;
}

const BTN =
  "font-display text-xs shrink-0 min-h-[44px] px-3 inline-flex items-center justify-center rounded-lg border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";
const BTN_ON = "text-brand-orange border-brand-orange/30 hover:bg-brand-orange/10 cursor-pointer";
const BTN_OFF = "text-subtle border-border cursor-not-allowed opacity-60";

/**
 * Skaters you've played lately, newest first, with a one-tap rematch. A skater
 * you already have a game going with gets "Open game" instead, so a tap never
 * starts a duplicate.
 */
export function RecentlyPlayed({ opponents, onRematch, onOpenGame, onViewPlayer }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (opponents.length === 0) return null;

  const rematch = async (o: RecentOpponent) => {
    /* v8 ignore next -- the button is disabled while onRematch is unset or a rematch is pending */
    if (!onRematch || pending) return;
    setPending(o.uid);
    setFailed(null);
    try {
      await onRematch(o.uid, o.username);
    } catch {
      setFailed(o.username);
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="mb-6" aria-labelledby="recently-played-heading" data-testid="recently-played">
      <h2 id="recently-played-heading" className="mb-3 font-display text-[11px] tracking-[0.2em] text-brand-orange">
        RECENTLY PLAYED
      </h2>
      {failed && (
        <p role="alert" className="mb-2 font-body text-xs text-brand-red">
          Couldn&apos;t start a rematch with @{failed}. Try again.
        </p>
      )}
      <ul className="space-y-2">
        {opponents.map((o) => {
          const rec = formatRecord(o.wins, o.decided);
          const inProgressOnly = o.decided === 0 && !!o.activeGame;
          // Only declined/expired/no-winner games: no record worth showing ("0 / 0").
          const noRecord = o.decided === 0 && !o.activeGame;
          const summary = inProgressOnly ? "first game in progress" : noRecord ? null : rec.label;
          const busy = pending === o.uid;
          return (
            <li
              key={o.uid}
              className="flex min-h-[64px] items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-surface px-3.5 py-2.5 shadow-card"
            >
              <button
                type="button"
                onClick={() => onViewPlayer?.(o.uid)}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                aria-label={summary ? `@${o.username}, ${summary}. View profile` : `@${o.username}. View profile`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.06] bg-surface-alt font-display text-sm leading-none text-white/80">
                  {o.username[0].toUpperCase()}
                </span>
                <span className="min-w-0">
                  <ProUsername
                    username={o.username}
                    isVerifiedPro={o.isVerifiedPro}
                    className="block truncate font-display text-base leading-none text-white"
                  />
                  {inProgressOnly ? (
                    <span className="mt-1 block font-body text-xs text-muted">In progress</span>
                  ) : noRecord ? null : (
                    <RecordFigure
                      wins={o.wins}
                      games={o.decided}
                      caption="won"
                      className="mt-1 block font-body text-xs text-muted"
                      testId={`recent-record-${o.uid}`}
                    />
                  )}
                </span>
              </button>
              {o.activeGame ? (
                <button
                  type="button"
                  onClick={() => onOpenGame(o.activeGame as GameDoc)}
                  className={`${BTN} ${BTN_ON}`}
                  aria-label={`Open your game with @${o.username}`}
                >
                  Open game
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void rematch(o)}
                  disabled={!onRematch || pending !== null}
                  className={`${BTN} ${onRematch && !pending ? BTN_ON : BTN_OFF}`}
                  aria-label={onRematch ? `Rematch @${o.username}` : `Rematch @${o.username}, verify email to rematch`}
                  aria-busy={busy || undefined}
                >
                  {busy ? "Starting…" : "Rematch"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
