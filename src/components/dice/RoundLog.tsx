import { useState } from "react";
import type { DiceRoundView } from "../../services/dice";
import { Die } from "./Die";

interface RoundLogProps {
  rounds: readonly DiceRoundView[];
  uid: string;
  names: Readonly<Record<string, string>>;
  /** "Round" for C-Lo and 4-5-6, "Hand" for craps and 10,000. */
  unit: "Round" | "Hand";
}

const SHOWN = 4;

/** Every finished round or hand, newest first, with both hands where there were two. */
export function RoundLog({ rounds, uid, names, unit }: RoundLogProps) {
  const [all, setAll] = useState(false);
  if (rounds.length === 0) return null;
  const list = [...rounds].reverse();
  const visible = all ? list : list.slice(0, SHOWN);
  const who = (id: string | null): string =>
    id === null ? "No score" : id === uid ? "You" : `@${names[id] ?? "them"}`;

  return (
    <section aria-labelledby="dice-rounds-title" className="mt-6">
      <h2 id="dice-rounds-title" className="mb-2 font-display text-sm tracking-[0.18em] text-muted">
        {unit === "Round" ? "Rounds" : "Hands"} · {rounds.length}
      </h2>
      <ol className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.06] bg-surface">
        {visible.map((r, index) => (
          <li key={`${r.round}-${r.at}-${index}`} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-body text-sm text-white">
                <span className="mr-2 font-display tracking-wider text-muted">
                  {unit === "Round" ? "R" : "H"}
                  {r.round}
                </span>
                {r.winner === null && r.points === 0 && r.label === "Tie"
                  ? "Tie, replayed"
                  : `${who(r.winner)} · ${r.label}`}
              </p>
              <span
                className={`font-display tracking-wider ${r.points > 0 ? (r.winner === uid ? "text-brand-orange" : "text-white") : "text-muted"}`}
              >
                {r.points > 0 ? `+${r.points.toLocaleString("en-US")}` : "0"}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
              {Object.entries(r.hands).map(([id, hand]) => (
                <span key={id} className="flex items-center gap-1.5 font-body text-xs text-bright">
                  <span className="sr-only">{who(id)}:</span>
                  <span aria-hidden="true" className="w-9 truncate text-muted">
                    {id === uid ? "You" : (names[id] ?? "")}
                  </span>
                  <span className="flex gap-0.5" aria-hidden="true">
                    {hand.dice.map((face, i) => (
                      <Die key={i} face={face} size="xs" order={i} />
                    ))}
                  </span>
                  <span>{hand.label}</span>
                </span>
              ))}
            </div>
          </li>
        ))}
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
