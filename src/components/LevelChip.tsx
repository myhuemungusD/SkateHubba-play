/**
 * Reusable level badge displayed near the avatar / username.
 *
 * Renders the caller-supplied `level`, clamped to [1, 30]. Defaults to 1
 * when the prop is omitted — main has no `level` field on `UserProfile`
 * yet, so every current call site bottoms out at L1. A future PR that
 * lands the XP/level counter will start passing real values; no callsite
 * change required.
 *
 * Accessibility (plan §7.4): `aria-label` carries the verbose form so
 * screen readers announce "Level 1" rather than "L1".
 */
interface Props {
  /** Profile level, clamped to [1, 30]. Defaults to 1 when omitted. */
  level?: number;
}

const MIN_LEVEL = 1;
const MAX_LEVEL = 30;

export function LevelChip({ level = MIN_LEVEL }: Props) {
  const clamped = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.floor(level)));
  return (
    <span
      role="img"
      aria-label={`Level ${clamped}`}
      className="inline-flex items-center justify-center px-2 py-0.5 rounded-md bg-brand-orange/[0.12] border border-brand-orange/30 font-display text-xs tracking-wider text-brand-orange leading-none tabular-nums"
    >
      L{clamped}
    </span>
  );
}
