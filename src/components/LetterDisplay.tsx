import { LETTERS } from "../utils/helpers";

export function LetterDisplay({
  count,
  name,
  active,
  isVerifiedPro,
  testId,
}: {
  count: number;
  name: string;
  active?: boolean;
  isVerifiedPro?: boolean;
  /**
   * Stable selector for e2e tests. Decoupled from `name` because call sites
   * pass `name={`@${username}`}` for display, and tests shouldn't depend on
   * that cosmetic prefix. Falls back to `letter-display-${name}` when not set.
   */
  testId?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-2 px-4 py-3.5 rounded-2xl border transition-all duration-300 ease-smooth min-w-[88px] backdrop-blur-sm
        ${active ? "border-brand-orange/40 bg-brand-orange/[0.08] shadow-glow-sm" : "border-white/[0.06] bg-surface/40"}`}
      aria-label={`${name}: ${LETTERS.slice(0, count).join(".")}${count > 0 ? "." : "no letters"}`}
      data-testid={testId ?? `letter-display-${name}`}
      data-letter-count={count}
    >
      <span
        className={`font-body text-xs font-semibold tracking-wide ${isVerifiedPro ? "pro-username" : active ? "text-brand-orange" : "text-muted"}`}
      >
        {name}
      </span>
      <div className="flex gap-1.5">
        {LETTERS.map((l, i) => (
          <span
            key={i}
            className={`font-display text-xl transition-all duration-300 ease-smooth
              ${i < count ? "text-brand-red scale-110 drop-shadow-[0_0_12px_rgba(255,61,0,0.5)]" : "text-border"}`}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
