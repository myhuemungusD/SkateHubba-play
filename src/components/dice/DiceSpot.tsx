import type { ReactNode } from "react";
import { Die, type DieMotion, type DieSize } from "./Die";

export interface DiceSelection {
  selected: ReadonlySet<number>;
  /** Dice that can score; the rest are dimmed. */
  live: ReadonlySet<number>;
  onToggle: (index: number) => void;
}

interface DiceSpotProps {
  /** Faces to show, or null for dice in hand (nothing rolled yet). */
  dice: readonly number[] | null;
  /** Changes on every new roll so the dice remount and land again. */
  rollKey: string;
  /** How many dice are in hand when nothing is showing. */
  count: number;
  size: DieSize;
  rolling: boolean;
  landing: boolean;
  quick: boolean;
  onSkip: () => void;
  selection?: DiceSelection;
  /** 10,000: faces already set aside this turn. */
  kept?: readonly number[];
  /** Craps: the shooter's point. */
  point?: number | null;
  children?: ReactNode;
}

/**
 * The ledge: poured concrete with angle-iron coping and a little wax shine.
 * Every game rolls here. Tapping while the dice land skips the reveal.
 */
export function DiceSpot({
  dice,
  rollKey,
  count,
  size,
  rolling,
  landing,
  quick,
  onSkip,
  selection,
  kept,
  point,
  children,
}: DiceSpotProps) {
  const faces = dice ?? Array.from({ length: count }, () => 0);
  let motion: DieMotion = "rest";
  if (rolling) motion = quick ? "rest" : "rattle";
  else if (landing) motion = quick ? "fade" : "land";
  const canPick = Boolean(selection) && !rolling && !landing;

  return (
    <div
      data-testid="dice-spot"
      onClick={landing ? onSkip : undefined}
      className="relative overflow-hidden rounded-[20px] bg-[#5f5d59] bg-concrete shadow-[inset_0_-18px_30px_rgba(0,0,0,0.28),0_10px_30px_rgba(0,0,0,0.35)]"
    >
      <div
        aria-hidden="true"
        className="h-2.5 bg-gradient-to-b from-[#ececec] via-[#a3a3a3] to-[#4f4f4f] shadow-[0_2px_3px_rgba(0,0,0,0.45)]"
      />
      <div aria-hidden="true" className="absolute bottom-0 left-[64%] top-2.5 w-px bg-black/20" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(112deg,transparent_28%,rgba(255,255,255,0.07)_44%,transparent_58%)]"
      />
      {point ? (
        <span className="absolute right-3 top-5 rounded-full bg-[#f2f2f2] px-2.5 py-0.5 font-display text-sm tracking-wider text-[#111] shadow-[0_2px_4px_rgba(0,0,0,0.4)]">
          Point {point}
        </span>
      ) : null}
      <div
        className={`relative flex min-h-[150px] flex-wrap items-center justify-center px-3 pb-6 pt-7 ${size === "lg" ? "gap-4" : "gap-1.5"}`}
        aria-busy={rolling || landing}
      >
        {faces.map((face, index) => (
          <Die
            key={`${rolling ? "hand" : rollKey}-${index}`}
            face={rolling ? 0 : face}
            size={size}
            order={index}
            motion={motion}
            selected={selection?.selected.has(index)}
            dead={selection ? !selection.live.has(index) && !selection.selected.has(index) : false}
            onToggle={canPick && selection ? () => selection.onToggle(index) : undefined}
            label={rolling ? "Die, rolling" : undefined}
          />
        ))}
      </div>
      {kept && kept.length > 0 ? (
        <div className="relative flex items-center gap-1.5 border-t border-black/15 bg-black/10 px-3 py-2">
          <span className="mr-1 font-display text-xs tracking-[0.18em] text-white/70">Set aside</span>
          {kept.map((face, index) => (
            <Die key={`kept-${index}`} face={face} size="xs" order={index} />
          ))}
        </div>
      ) : null}
      {children}
    </div>
  );
}
