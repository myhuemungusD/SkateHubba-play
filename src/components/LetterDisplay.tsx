import { isExtrasEnabled } from "../lib/featureFlags";
import { LetterPips } from "./LetterPips";
import { Timer } from "./Timer";

export function LetterDisplay({
  count,
  name,
  active,
  turnLabel,
  deadline,
  isVerifiedPro,
  testId,
}: {
  count: number;
  name: string;
  /** This player must act now. Only one card in a scoreboard is ever active. */
  active?: boolean;
  /** Spelled-out status on the active card ("YOUR MOVE", "THEIR MOVE"). */
  turnLabel?: string;
  /** Turn deadline, shown on the active card so the clock sits with the player who's on it. */
  deadline?: number;
  isVerifiedPro?: boolean;
  /**
   * Stable selector for e2e tests. Decoupled from `name` because call sites
   * pass `name={`@${username}`}` for display, and tests shouldn't depend on
   * that cosmetic prefix. Falls back to `letter-display-${name}` when not set.
   */
  testId?: string;
}) {
  // Verified Pro shimmer is frozen with the other extras (src/lib/featureFlags.ts).
  const showPro = isVerifiedPro === true && isExtrasEnabled();
  return (
    <div
      className={`flex flex-col items-center gap-2 px-4 py-3.5 rounded-2xl border transition-all duration-300 ease-smooth min-w-[88px] backdrop-blur-sm
        ${active ? "border-brand-orange bg-brand-orange/[0.1] shadow-glow-sm" : "border-white/[0.06] bg-surface/40 opacity-70"}`}
      data-testid={testId ?? `letter-display-${name}`}
      data-letter-count={count}
      data-active={active ? "true" : "false"}
    >
      {active && turnLabel && (
        <span className="rounded-full bg-brand-orange px-2.5 py-0.5 font-display text-sm tracking-wider text-black leading-tight">
          {turnLabel}
        </span>
      )}
      <span
        className={`font-body text-xs font-semibold tracking-wide ${showPro ? "pro-username" : active ? "text-white" : "text-muted"}`}
      >
        {name}
      </span>
      <LetterPips count={count} label={name} size="lg" />
      {active && deadline !== undefined && <Timer deadline={deadline} />}
    </div>
  );
}
