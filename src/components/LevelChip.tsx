/**
 * Reusable level badge displayed near the avatar / username.
 *
 * PR-C ships this as a placeholder rendering "L1" until PR-E activates the
 * real XP system behind `feature.profile_xp`. Callers always pass the live
 * `level` from the profile (defaults to 1 on read) — when the flag is off
 * PR-E will simply pass `1` so this chip continues to render harmlessly.
 *
 * Accessibility (plan §7.4): `aria-label` carries the verbose form so
 * screen readers announce "Level 12" rather than "L12".
 */
interface Props {
  /** 1..30 (clamped at the call site). Defaults to 1 if profile.level is missing. */
  level: number;
}

export function LevelChip({ level }: Props) {
  return (
    <span
      role="img"
      aria-label={`Level ${level}`}
      className="inline-flex items-center justify-center px-2 py-0.5 rounded-md bg-brand-orange/[0.12] border border-brand-orange/30 font-display text-xs tracking-wider text-brand-orange leading-none tabular-nums"
    >
      L{level}
    </span>
  );
}
