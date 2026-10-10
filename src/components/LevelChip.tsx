/**
 * Level badge displayed beside a username.
 *
 * The number is `levelForXp(xp)`, clamped to 1..50. Absent XP is level 1.
 * `aria-label` carries "Level N" so a screen reader does not announce "L1".
 */
interface Props {
  /** 1..50. Values outside that range are clamped. */
  level?: number;
}

function clampLevel(level: number | undefined): number {
  if (typeof level !== "number" || !Number.isFinite(level)) return 1;
  return Math.min(50, Math.max(1, Math.floor(level)));
}

export function LevelChip({ level }: Props) {
  const shown = clampLevel(level);
  return (
    <span
      role="img"
      aria-label={`Level ${shown}`}
      className="inline-flex items-center justify-center px-2 py-0.5 rounded-md bg-brand-orange/[0.12] border border-brand-orange/30 font-display text-xs tracking-wider text-brand-orange leading-none tabular-nums"
    >
      L{shown}
    </span>
  );
}
