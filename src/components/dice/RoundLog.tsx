import { useState } from "react";
import type { DiceRoundView } from "../../services/dice";
import { Die } from "./Die";

interface RoundLogProps {
  rounds: readonly DiceRoundView[];
  uid: string;
  names: Readonly<Record<string, string>>;
  /** "Round" for C-Lo and 4-5-6 (both throw), "Hand" for craps and 10,000 (one skater per hand). */
  unit: "Round" | "Hand";
}

const SHOWN = 4;

/** A hand name people read: "Banked 1,050", "Farkle, lost 200". Older docs wrote "1050". */
export function handName(label: string): string {
  return label.replace(/\b\d{4,}\b/g, (n) => Number(n).toLocaleString("en-US")).replace(/ · /g, ", ");
}

/** What a finished round or hand says on its first line. */
function headline(r: DiceRoundView, unit: RoundLogProps["unit"], who: (id: string) => string): string {
  if (unit === "Hand") {
    const shooter = Object.keys(r.hands)[0] ?? r.winner;
    return shooter ? who(shooter) : "No score";
  }
  if (r.winner === null) return r.label === "Tie" ? "Tie, replayed" : "No winner";
  return `${who(r.winner)} took it`;
}

/** Every finished round or hand, newest first, each named by who threw it. */
export function RoundLog({ rounds, uid, names, unit }: RoundLogProps) {
  const [all, setAll] = useState(false);
  if (rounds.length === 0) return null;
  const list = [...rounds].reverse();
  const visible = all ? list : list.slice(0, SHOWN);
  const who = (id: string): string => (id === uid ? "You" : `@${names[id] || "them"}`);

  return (
    <section aria-labelledby="dice-rounds-title" className="mt-6">
      <h2 id="dice-rounds-title" className="mb-2 font-display text-sm tracking-[0.18em] text-muted">
        {unit === "Round" ? "Rounds" : "Hands"} · {rounds.length}
      </h2>
      <ol className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.06] bg-surface">
        {visible.map((r, index) => {
          const hands = Object.entries(r.hands);
          const mine = r.winner === uid;
          return (
            <li key={`${r.round}-${r.at}-${index}`} className="px-4 py-3" data-testid="dice-round-row">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate font-body text-sm text-white">
                  {headline(r, unit, who)}
                  <span className="ml-2 font-body text-xs text-muted">
                    {unit} {r.round}
                  </span>
                </p>
                <span
                  className={`shrink-0 font-display tracking-wider ${r.points > 0 ? (mine ? "text-brand-orange" : "text-white") : "text-muted"}`}
                >
                  {r.points > 0 ? `+${r.points.toLocaleString("en-US")}` : "0"}
                </span>
              </div>
              <ul className="mt-1.5 space-y-1">
                {hands.map(([id, hand]) => (
                  <li key={id} className="flex items-center gap-2 font-body text-xs text-bright">
                    {unit === "Round" ? (
                      <span className="w-20 shrink-0 truncate text-muted">{who(id)}</span>
                    ) : (
                      <span className="sr-only">{who(id)}:</span>
                    )}
                    <span className="flex shrink-0 gap-0.5" aria-hidden="true">
                      {hand.dice.map((face, i) => (
                        <Die key={i} face={face} size="xs" order={i} />
                      ))}
                    </span>
                    <span className="min-w-0 truncate">{handName(hand.label)}</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
      {list.length > SHOWN ? (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-1 inline-flex min-h-11 items-center font-body text-sm text-brand-orange"
        >
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      ) : null}
    </section>
  );
}
