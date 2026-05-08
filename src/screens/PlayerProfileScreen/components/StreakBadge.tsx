import { useEffect, useRef } from "react";
import { FlameIcon } from "../../../components/icons";
import { analytics } from "../../../services/analytics";

/**
 * Sticky "currently on a streak" chip rendered near the top of the profile
 * when `currentWinStreak >= 3`. Replaces the legacy {@link WinStreakBanner}
 * (DELETED in PR-C, plan §6.4).
 *
 * Plan §1 locked decision: streak presentation is **celebratory only**, never
 * punitive. There is no "streak in danger" copy, no "you broke your streak"
 * banner, no notifications on loss. Duolingo's 2023-2024 streak-burnout
 * research drove this — see the Decision Log entry dated 2026-05-08.
 *
 * The chip hides itself entirely when the streak is below the threshold so
 * callers don't have to guard at the call site (and so a streak loss
 * silently removes the chip without any "you lost your streak" UX).
 */
interface Props {
  /** Authoritative streak count from `users/{uid}.currentWinStreak`. */
  currentWinStreak: number;
}

/** Plan §6.4 + §1: chip is visible at exactly streak ≥3, hidden below 3. */
const STREAK_THRESHOLD = 3;

export function StreakBadge({ currentWinStreak }: Props) {
  // ── profile_streak_badge_displayed telemetry (plan §7.2) ──
  // Fires the first time the badge mounts at a given streak length.
  // `lastFiredStreakRef` tracks the most recent streak we emitted for so
  // re-renders at the same streak don't double-fire. A change in streak
  // length (3 → 4 → 5 …) does fire again — that's the brag-celebration
  // signal we want for the dashboard. The ref deliberately persists
  // across the threshold-gated early-return so a streak rising back to
  // ≥3 after a dip emits a fresh event.
  const lastFiredStreakRef = useRef<number | null>(null);
  useEffect(() => {
    if (currentWinStreak < STREAK_THRESHOLD) return;
    if (lastFiredStreakRef.current === currentWinStreak) return;
    lastFiredStreakRef.current = currentWinStreak;
    analytics.profileStreakBadgeDisplayed(currentWinStreak);
  }, [currentWinStreak]);

  if (currentWinStreak < STREAK_THRESHOLD) return null;
  return (
    <div
      role="status"
      aria-label={`On a ${currentWinStreak} game win streak`}
      data-testid="streak-badge"
      className="sticky top-2 z-20 flex items-center justify-center gap-2 mx-auto mb-6 px-4 py-2 rounded-full border border-brand-orange/40 bg-brand-orange/[0.10] shadow-glow-sm w-max grain"
    >
      <FlameIcon size={16} className="text-brand-orange" />
      <span className="font-display text-sm tracking-wider text-brand-orange leading-none tabular-nums">
        {currentWinStreak}-GAME STREAK
      </span>
    </div>
  );
}
