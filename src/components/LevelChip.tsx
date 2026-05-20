/**
 * Reusable level badge displayed near the avatar / username.
 *
 * Currently a placeholder — main has no `level` field on UserProfile yet,
 * so this always renders L1 regardless of the prop value passed by
 * callers. A future PR that lands the XP/level counter system will
 * activate real per-user levels; the prop signature is preserved so the
 * call sites do not need to change when that happens.
 *
 * Accessibility (plan §7.4): `aria-label` carries the verbose form so
 * screen readers announce "Level 1" rather than "L1".
 */
interface Props {
  /**
   * Currently ignored — see file docstring. Will become 1..30 (clamped at
   * the call site) once the level counter ships. Kept on the prop
   * signature so existing call sites compile unchanged.
   */
  level?: number;
}

export function LevelChip(_props: Props) {
  // Hard-coded L1 until the level counter ships. See file docstring.
  const level = 1;
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
