import { useEffect, useRef, useState } from "react";
import type { ProfileStats } from "../usePlayerProfileController";
import { MIN_RATED_GAMES } from "../../../constants/stats";
import { useReducedMotion } from "../../../hooks/useReducedMotion";

/**
 * Profile stats grid — modern UX, adapted to main's `wins`/`losses` shape.
 *
 * Layout:
 *   • Brag row:   Lifetime Wins · Lifetime Losses · Win Rate %
 *   • Detail row: Total Games (always)
 *   • VS-You row: H2H record — opponent profile only.
 *
 * Number formatting via Intl compact (audit H1: "1.2K" instead of "1234").
 * Count-up animation gated by `prefers-reduced-motion` (plan §7.4).
 *
 * **Audit D1 — accessibility critical**: each tile sets `aria-label` to the
 * FINAL numeric value before the animation begins. The visible text tweens
 * from 0 → final, but the screen-reader label is static so NVDA / VoiceOver
 * announce "Lifetime wins: forty-seven" once, not "1, 2, 3...".
 *
 * Fields that aren't backed by counters on the current schema (longest
 * streak, tricks landed, clean judgments, level/xp, spots added/checked-in)
 * are intentionally hidden — a future PR will activate them once their
 * counters ship.
 */

const formatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function formatCompact(n: number): string {
  return formatter.format(n);
}

interface Props {
  stats: ProfileStats;
  isOwnProfile: boolean;
  /** Used to suppress the VS-You row when there are no shared games yet. */
  hasCompletedGames: boolean;
  /** Tap handler for stat tiles — fires `profileStatTileTapped` telemetry. */
  onTileTap?: (statName: StatTileName) => void;
}

export type StatTileName =
  | "wins"
  | "losses"
  | "winRate"
  | "totalGames"
  | "vsYouWins"
  | "vsYouLosses"
  | "vsYouTotal"
  | "tricksDisputed"
  | "disputesRaised"
  | "disputesRight"
  | "disputesWrong";

export function ProfileStatsGrid({ stats, isOwnProfile, hasCompletedGames, onTileTap }: Props) {
  return (
    <div className="mb-8">
      {/* Brag row — plan §1 priority order, adapted to main's counter set. */}
      <Row testid="brag-row" cols="grid-cols-3">
        <StatTile
          name="wins"
          label="Lifetime Wins"
          value={stats.wins}
          ariaLabel={`Lifetime wins: ${stats.wins}`}
          onTap={onTileTap}
        />
        <StatTile
          name="losses"
          label="Lifetime Losses"
          value={stats.losses}
          ariaLabel={`Lifetime losses: ${stats.losses}`}
          onTap={onTileTap}
        />
        {/* A rate over fewer than MIN_RATED_GAMES games is noise dressed as a
            fact (1-0 reads "100%"), so it stays a dash until the floor is met.
            The aria-label says why rather than announcing a bare "dash". */}
        <StatTile
          name="winRate"
          label="Win Rate %"
          value={stats.winRate}
          suffix="%"
          ariaLabel={
            stats.winRate === null
              ? `Win rate: not enough games yet, ${MIN_RATED_GAMES} needed`
              : `Win rate: ${stats.winRate} percent`
          }
          onTap={onTileTap}
        />
      </Row>

      {/* Detail row — Total Games on its own row keeps the layout balanced. */}
      <Row testid="detail-row" cols="grid-cols-1">
        <StatTile
          name="totalGames"
          label="Total Games"
          value={stats.total}
          ariaLabel={`Total games: ${stats.total}`}
          onTap={onTileTap}
        />
      </Row>

      {/* Disputes section — public binding-dispute counters, shown on every
          profile. Two raw counts, then the right/wrong split of the disputes
          this player raised. */}
      <p className="font-display text-[10px] tracking-[0.2em] text-amber-400 mb-2.5 mt-2 animate-fade-in">DISPUTES</p>
      <Row testid="disputes-row" cols="grid-cols-2">
        <StatTile
          name="tricksDisputed"
          label="Tricks of yours disputed"
          value={stats.tricksDisputed}
          ariaLabel={`Tricks of yours disputed: ${stats.tricksDisputed}`}
          onTap={onTileTap}
        />
        <StatTile
          name="disputesRaised"
          label="Tricks you disputed"
          value={stats.disputesRaised}
          ariaLabel={`Tricks you disputed: ${stats.disputesRaised}`}
          onTap={onTileTap}
        />
      </Row>
      <Row testid="disputes-record-row" cols="grid-cols-2">
        <StatTile
          name="disputesRight"
          label="Right"
          value={stats.disputesRight}
          ariaLabel={`Disputes you got right: ${stats.disputesRight}`}
          onTap={onTileTap}
        />
        <StatTile
          name="disputesWrong"
          label="Wrong"
          value={stats.disputesWrong}
          ariaLabel={`Disputes you got wrong: ${stats.disputesWrong}`}
          onTap={onTileTap}
        />
      </Row>

      {/* VS-You row — opponent profile only. Computed from games history. */}
      {!isOwnProfile && hasCompletedGames && (
        <>
          <p className="font-display text-[10px] tracking-[0.2em] text-brand-orange mb-2.5 mt-2 animate-fade-in">
            VS YOU
          </p>
          <Row testid="vs-you-row" cols="grid-cols-3">
            <StatTile
              name="vsYouWins"
              label="Your Wins"
              value={stats.vsYouWins}
              ariaLabel={`Your wins: ${stats.vsYouWins}`}
              onTap={onTileTap}
            />
            <StatTile
              name="vsYouLosses"
              label="Your Losses"
              value={stats.vsYouLosses}
              ariaLabel={`Your losses: ${stats.vsYouLosses}`}
              onTap={onTileTap}
            />
            <StatTile
              name="vsYouTotal"
              label="Games"
              value={stats.vsYouTotal}
              ariaLabel={`Total head-to-head games: ${stats.vsYouTotal}`}
              onTap={onTileTap}
            />
          </Row>
        </>
      )}
    </div>
  );
}

function Row({ cols, testid, children }: { cols: string; testid: string; children: React.ReactNode }) {
  return (
    <div data-testid={testid} className={`grid ${cols} gap-2.5 mb-2.5 animate-fade-in`}>
      {children}
    </div>
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
function StatTile({ name, label, value, suffix, ariaLabel, onTap }: StatTileProps) {
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
      className="text-left rounded-2xl glass-card p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
    >
      <p className="font-display text-2xl text-white leading-none tabular-nums">
        {value === null ? (
          <span className="text-subtle">{UNAVAILABLE}</span>
        ) : (
          <>
            {formatCompact(display)}
            {suffix}
          </>
        )}
      </p>
      <p className="font-body text-[10px] uppercase tracking-wider text-subtle mt-2">{label}</p>
    </button>
  );
}
