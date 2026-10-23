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
      className={`@container flex min-w-0 flex-1 basis-0 flex-col items-center gap-2 px-2 py-3.5 rounded-2xl border transition-all duration-300 ease-smooth backdrop-blur-sm sm:max-w-[13rem] sm:px-4
        ${active ? "border-brand-orange bg-brand-orange/[0.1] shadow-glow-sm" : "border-white/[0.06] bg-surface/40"}`}
      data-testid={testId ?? `letter-display-${name}`}
      data-letter-count={count}
      data-active={active ? "true" : "false"}
    >
      {/* The pill and clock rows are reserved (invisible) on the inactive card,
          so the scoreboard keeps one height when the turn flips (SF-B3). */}
      {turnLabel &&
        (active ? (
          <span className="rounded-full bg-brand-orange px-2.5 py-0.5 font-display text-sm tracking-wider text-black leading-tight">
            {turnLabel}
          </span>
        ) : (
          <span
            aria-hidden="true"
            data-testid="turn-pill-spacer"
            className="invisible rounded-full px-2.5 py-0.5 font-display text-sm leading-tight"
          >
            {"\u00a0"}
          </span>
        ))}
      <span
        className={`max-w-full truncate font-body text-xs font-semibold tracking-wide ${showPro ? "pro-username" : active ? "text-white" : "text-dim"}`}
      >
        {name}
      </span>
      <LetterPips count={count} label={name} size="fit" />
      {deadline !== undefined &&
        (active ? (
          <Timer deadline={deadline} />
        ) : (
          <div aria-hidden="true" data-testid="timer-spacer" className="invisible">
            <Timer deadline={deadline} />
          </div>
        ))}
    </div>
  );
}
