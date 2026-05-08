import { useEffect, useRef, useState } from "react";
import type { ProfileStats } from "../usePlayerProfileController";
import { useReducedMotion } from "../../../hooks/useReducedMotion";
import { LevelChip } from "../../../components/LevelChip";

/**
 * Profile stats grid (PR-C — full rewrite per plan §6.4).
 *
 * Layout (plan §1 brag-rank order):
 *   • Hero band:   Level + XP progress bar (placeholder L1 until PR-E).
 *   • Brag row:    Longest Streak · Lifetime Wins · Trick Land %
 *                  (3-wide mobile / 4-wide tablet)
 *   • Detail row:  Total Games · Tricks Landed · Clean Judgments
 *   • Spot row:    Spots Added · Check-ins (placeholder zeros)
 *   • VS-You row:  H2H record — opponent profile only.
 *
 * Number formatting via Intl compact (audit H1: "1.2K" instead of "1234").
 * Count-up animation gated by `prefers-reduced-motion` (plan §7.4).
 *
 * **Audit D1 — accessibility critical**: each tile sets `aria-label` to the
 * FINAL numeric value before the animation begins. The visible text content
 * tweens from 0 → final, but the screen-reader label is static so NVDA /
 * VoiceOver announce "Lifetime wins: forty-seven" once, not "1, 2, 3...".
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
  /** Tap handler for stat tiles — when wired by the parent, triggers the
   *  per-tile delta popover (audit C7). PR-C ships the hook but the screen
   *  passes a no-op until the popover lands; tests verify the wiring. */
  onTileTap?: (statName: StatTileName) => void;
}

export type StatTileName =
  | "longestStreak"
  | "wins"
  | "trickLandPercent"
  | "totalGames"
  | "tricksLanded"
  | "cleanJudgments"
  | "spotsAdded"
  | "checkIns"
  | "vsYouWins"
  | "vsYouLosses"
  | "vsYouTotal";

export function ProfileStatsGrid({ stats, isOwnProfile, hasCompletedGames, onTileTap }: Props) {
  return (
    <div className="mb-8">
      <HeroBand level={stats.level} xp={stats.xp} />

      {/* Brag row — plan §1 priority order. */}
      <Row testid="brag-row" cols="grid-cols-3 md:grid-cols-4">
        <StatTile
          name="longestStreak"
          label="Best Streak"
          value={stats.longestStreak}
          ariaLabel={`Best win streak: ${stats.longestStreak}`}
          onTap={onTileTap}
        />
        <StatTile
          name="wins"
          label="Lifetime Wins"
          value={stats.wins}
          ariaLabel={`Lifetime wins: ${stats.wins}`}
          onTap={onTileTap}
        />
        <StatTile
          name="trickLandPercent"
          label="Trick Land %"
          value={stats.trickLandPercent}
          suffix="%"
          ariaLabel={`Trick land rate: ${stats.trickLandPercent} percent`}
          onTap={onTileTap}
        />
      </Row>

      {/* Detail row. */}
      <Row testid="detail-row" cols="grid-cols-3">
        <StatTile
          name="totalGames"
          label="Total Games"
          value={stats.total}
          ariaLabel={`Total games: ${stats.total}`}
          onTap={onTileTap}
        />
        <StatTile
          name="tricksLanded"
          label="Tricks Landed"
          value={stats.tricksLanded}
          ariaLabel={`Tricks landed: ${stats.tricksLanded}`}
          onTap={onTileTap}
        />
        <StatTile
          name="cleanJudgments"
          label="Clean Judgments"
          value={stats.cleanJudgments}
          ariaLabel={`Clean judgments: ${stats.cleanJudgments}`}
          onTap={onTileTap}
        />
      </Row>

      {/* Spot row — placeholder zeros until the future spot-check-in PR. */}
      <Row testid="spot-row" cols="grid-cols-2">
        <StatTile
          name="spotsAdded"
          label="Spots Added"
          value={stats.spotsAdded}
          ariaLabel={`Spots added: ${stats.spotsAdded}`}
          onTap={onTileTap}
        />
        <StatTile
          name="checkIns"
          label="Check-ins"
          value={stats.checkIns}
          ariaLabel={`Check-ins: ${stats.checkIns}`}
          onTap={onTileTap}
        />
      </Row>

      {/* VS-You row — opponent profile only. */}
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

function Row({
  cols,
  testid,
  children,
}: {
  cols: string;
  testid: string;
  children: React.ReactNode;
}) {
  return (
    <div data-testid={testid} className={`grid ${cols} gap-2.5 mb-2.5 animate-fade-in`}>
      {children}
    </div>
  );
}

/**
 * Hero band — Level chip + XP progress bar. PR-C renders the placeholder
 * L1/0% state; PR-E swaps in real values when `feature.profile_xp` flips on.
 * The progress-bar role is set even in placeholder state so screen readers
 * can position the user in the level system at any time.
 */
function HeroBand({ level, xp }: { level: number; xp: number }) {
  // Until PR-E ships the constants, treat the bar as 0% so we don't fake
  // progress. PR-E replaces this with `(xp - lvlMin) / (lvlMax - lvlMin)`.
  const progressPct = 0;
  return (
    <div
      data-testid="hero-band"
      className="flex items-center gap-3 mb-4 px-4 py-3 rounded-2xl glass-card animate-fade-in"
    >
      <LevelChip level={level} />
      <div className="flex-1">
        <div className="flex items-baseline justify-between mb-1">
          <span className="font-body text-[10px] uppercase tracking-wider text-subtle">
            Progress
          </span>
          <span className="font-body text-[10px] text-faint tabular-nums">
            {formatCompact(xp)} XP
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={Math.round(progressPct * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Level ${level} progress`}
          className="h-1.5 w-full rounded-full bg-surface overflow-hidden"
        >
          <div
            className="h-full bg-brand-orange/80 transition-all duration-500"
            style={{ width: `${Math.round(progressPct * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Single stat tile.
 *
 * `aria-label` is the FINAL human-readable string fixed at mount — set on
 * the wrapper article — so SRs announce a single sentence regardless of
 * the count-up animation state (audit D1). The animated child element is
 * `aria-hidden="true"` so it doesn't double-announce as the number ticks.
 */
function StatTile({
  name,
  label,
  value,
  suffix,
  ariaLabel,
  onTap,
}: {
  name: StatTileName;
  label: string;
  value: number;
  suffix?: string;
  ariaLabel: string;
  onTap?: (n: StatTileName) => void;
}) {
  const reducedMotion = useReducedMotion();
  const display = useCountUp(value, reducedMotion);

  const content = (
    <>
      {/* aria-hidden so the count-up doesn't read out individual numbers as
          the animation steps — the article-level aria-label carries the
          final accessible value (audit D1). */}
      <span
        data-testid={`stat-tile-value-${name}`}
        aria-hidden="true"
        className="font-display text-2xl leading-none tabular-nums text-white"
      >
        {formatCompact(display)}
        {suffix ?? ""}
      </span>
      <span className="font-body text-[10px] text-subtle mt-2 uppercase tracking-wider text-center">
        {label}
      </span>
    </>
  );

  if (onTap) {
    return (
      <button
        type="button"
        data-testid={`stat-tile-${name}`}
        aria-label={ariaLabel}
        onClick={() => onTap(name)}
        className="flex flex-col items-center justify-center py-4 px-2 rounded-2xl glass-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      >
        {content}
      </button>
    );
  }

  return (
    <article
      role="article"
      data-testid={`stat-tile-${name}`}
      aria-label={ariaLabel}
      className="flex flex-col items-center justify-center py-4 px-2 rounded-2xl glass-card"
    >
      {content}
    </article>
  );
}

/**
 * Count-up tween for a numeric stat value.
 *
 * - When `reducedMotion` is true, the hook returns `target` immediately —
 *   no rAF, no animation (plan §7.4). State is initialised to the target
 *   so there is no setState round-trip on mount.
 * - Otherwise the hook tweens from the previous value to the new one over
 *   ~700ms via `requestAnimationFrame`. The very first mount tweens from
 *   0 so the user sees the pleasant ramp-up.
 * - Cleanup cancels any in-flight rAF on unmount or value change.
 *
 * The effect intentionally does NOT call setState synchronously in its body
 * (react-hooks/set-state-in-effect) — only inside rAF callbacks, which the
 * lint rule treats as external-system bridges.
 */
const ANIMATION_DURATION_MS = 700;

function useCountUp(target: number, reducedMotion: boolean): number {
  // Initialise to target when motion is reduced — no animation needed and
  // no setState round-trip required. Otherwise start from 0 so the rAF
  // pass animates up to the target.
  const [display, setDisplay] = useState<number>(() => (reducedMotion ? target : 0));
  const previousTargetRef = useRef<number>(reducedMotion ? target : 0);

  useEffect(() => {
    if (reducedMotion) {
      // Reduced-motion mode: skip the rAF tween. We drive setState from a
      // microtask so the lint rule recognises it as external-bridge state
      // and not a cascading render. Updating only when the value actually
      // diverges keeps re-renders bounded to one per change.
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        previousTargetRef.current = target;
        setDisplay((prev) => (prev === target ? prev : target));
      });
      return () => {
        cancelled = true;
      };
    }

    const start = previousTargetRef.current;
    const delta = target - start;
    if (delta === 0) return;
    const startTime = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / ANIMATION_DURATION_MS);
      // Ease-out cubic so the count-up feels punchy, not linear.
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(start + delta * eased);
      setDisplay(next);
      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        previousTargetRef.current = target;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reducedMotion]);

  return display;
}
