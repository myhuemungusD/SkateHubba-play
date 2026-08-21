import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../../../hooks/useReducedMotion";

/**
 * Presentational primitives shared by every section of the profile stats grid.
 *
 * Extracted from ProfileStatsGrid when that file grew category sections — the
 * grid is now composition only, and the tile/row rendering rules live here so
 * both files stay inside the 250-LOC component budget.
 *
 * Number formatting via Intl compact (audit H1: "1.2K" instead of "1234").
 * Count-up animation gated by `prefers-reduced-motion` (plan §7.4).
 *
 * **Audit D1 — accessibility critical**: each tile sets `aria-label` to the
 * FINAL numeric value before the animation begins. The visible text tweens
 * from 0 → final, but the screen-reader label is static so NVDA / VoiceOver
 * announce "Lifetime wins: forty-seven" once, not "1, 2, 3...".
 */

const formatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function formatCompact(n: number): string {
  return formatter.format(n);
}

export type StatTileName =
  | "wins"
  | "losses"
  | "winRate"
  | "totalGames"
  | "bestStreak"
  | "currentStreak"
  | "vsYouWins"
  | "vsYouLosses"
  | "vsYouTotal"
  | "tricksDisputed"
  | "disputesRaised"
  | "disputesRight"
  | "disputesWrong"
  | "lettersGiven"
  | "lettersTaken"
  | "cleanWins"
  | "comebackWins"
  | "challengeCompletion"
  | "gamesJudged";

/** Grid row wrapper. `testid` is how the specs address a whole section. */
export function Row({ cols, testid, children }: { cols: string; testid: string; children: React.ReactNode }) {
  return (
    <div data-testid={testid} className={`grid ${cols} gap-2 mb-2 animate-fade-in`}>
      {children}
    </div>
  );
}

/** Category label above a group of rows. Orange is the app's section accent. */
export function CategoryLabel({ title }: { title: string }) {
  return (
    <p className="font-display text-[10px] tracking-[0.2em] text-brand-orange mb-2.5 mt-2 animate-fade-in">{title}</p>
  );
}

interface StatTileProps {
  name: StatTileName;
  label: string;
  /** `null` renders the unavailable placeholder instead of a number. */
  value: number | null;
  suffix?: string;
  /** Pre-computed final-value label — must NOT change as the count-up runs. */
  ariaLabel: string;
  onTap?: (name: StatTileName) => void;
}

/** Shown when a stat exists but isn't meaningful yet (e.g. rate below the floor). */
const UNAVAILABLE = "—";

/**
 * Individual stat tile. The visible number tweens from 0 → `value` over
 * ~600 ms, gated by `prefers-reduced-motion`. The `aria-label` reflects
 * the final value at all times so screen readers never trip over the tween.
 */
export function StatTile({ name, label, value, suffix, ariaLabel, onTap }: StatTileProps) {
  const reducedMotion = useReducedMotion();
  // Animation source: we tween a separate `tweenValue` from 0 → value when
  // reduced-motion is OFF, and use the prop `value` directly when ON.
  // Keeping the two paths separated means the effect body never calls
  // `setState` in the reduced-motion branch — the
  // react-hooks/set-state-in-effect lint rule rejects that pattern.
  const [tweenValue, setTweenValue] = useState(0);
  const startedAt = useRef<number | null>(null);
  // A null stat has nothing to count up to; `numericValue` keeps the tween
  // effect's dependency stable while the render branch below shows a dash.
  const numericValue = value ?? 0;
  const display = reducedMotion ? numericValue : tweenValue;

  useEffect(() => {
    if (reducedMotion) {
      return;
    }
    let frame: number | null = null;
    const duration = 600;
    const start = (ts: number) => {
      if (startedAt.current === null) startedAt.current = ts;
      const progress = Math.min(1, (ts - startedAt.current) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setTweenValue(Math.round(numericValue * eased));
      if (progress < 1) {
        frame = requestAnimationFrame(start);
      }
    };
    frame = requestAnimationFrame(start);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      startedAt.current = null;
    };
  }, [reducedMotion, numericValue]);

  const handleClick = () => onTap?.(name);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      className="text-left rounded-xl bg-surface border border-white/[0.06] shadow-card p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
    >
      <p className="font-display text-xl text-white leading-none tabular-nums">
        {value === null ? (
          <span className="text-subtle">{UNAVAILABLE}</span>
        ) : (
          <>
            {formatCompact(display)}
            {suffix}
          </>
        )}
      </p>
      <p className="font-body text-[10px] uppercase tracking-wider text-subtle mt-1.5">{label}</p>
    </button>
  );
}
