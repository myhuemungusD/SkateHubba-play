import { Die } from "./Die";

export interface ScoreSide {
  uid: string;
  name: string;
  isYou: boolean;
  score: number;
  toMove: boolean;
  /** Settled hand this round (C-Lo / 4-5-6), shown so both lines are always visible. */
  hand: { dice: readonly number[]; label: string } | null;
  /** Extra status, e.g. "200 on the line". */
  note: string | null;
}

function Row({ side, target }: { side: ScoreSide; target: number }) {
  const pct = Math.min(100, Math.round((side.score / Math.max(1, target)) * 100));
  return (
    <li
      className={`rounded-2xl border px-4 py-3 ${side.toMove ? "border-brand-orange/50 bg-brand-orange/[0.06]" : "border-white/[0.06] bg-surface"}`}
      aria-current={side.toMove ? "true" : undefined}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border font-display text-base ${side.isYou ? "border-brand-orange text-brand-orange" : "border-white/25 text-white"}`}
        >
          {side.name.slice(0, 1).toUpperCase() || "?"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate font-body text-sm font-semibold text-white">
            <span className="truncate">{side.isYou ? "You" : `@${side.name}`}</span>
            {side.toMove ? (
              <span className="shrink-0 font-display text-[11px] tracking-[0.16em] text-brand-orange">To roll</span>
            ) : null}
          </p>
          {side.hand ? (
            <p className="mt-0.5 flex items-center gap-1.5 font-body text-xs text-bright">
              <span className="flex gap-0.5" aria-hidden="true">
                {side.hand.dice.map((face, i) => (
                  <Die key={i} face={face} size="xs" order={i} />
                ))}
              </span>
              <span>Set: {side.hand.label}</span>
            </p>
          ) : side.note ? (
            <p className="mt-0.5 font-body text-xs text-bright">{side.note}</p>
          ) : null}
        </div>
        <span className="font-display text-3xl leading-none tabular-nums text-white">
          {side.score.toLocaleString("en-US")}
        </span>
      </div>
      <div
        className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.08]"
        role="progressbar"
        aria-label={`${side.isYou ? "Your" : `@${side.name}'s`} progress to ${target.toLocaleString("en-US")}`}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={Math.min(side.score, target)}
      >
        <div
          className={`h-full rounded-full ${side.isYou ? "bg-brand-orange" : "bg-white/60"} ${WIDTH[Math.round(pct / 5)]}`}
        />
      </div>
    </li>
  );
}

/** Static width steps (5%) so Tailwind can see every class. */
const WIDTH = [
  "w-0",
  "w-[5%]",
  "w-[10%]",
  "w-[15%]",
  "w-[20%]",
  "w-[25%]",
  "w-[30%]",
  "w-[35%]",
  "w-[40%]",
  "w-[45%]",
  "w-[50%]",
  "w-[55%]",
  "w-[60%]",
  "w-[65%]",
  "w-[70%]",
  "w-[75%]",
  "w-[80%]",
  "w-[85%]",
  "w-[90%]",
  "w-[95%]",
  "w-full",
];

export function Scoreboard({ you, them, target }: { you: ScoreSide; them: ScoreSide; target: number }) {
  return (
    <ul className="space-y-2" aria-label="Score">
      <Row side={you} target={target} />
      <Row side={them} target={target} />
    </ul>
  );
}
