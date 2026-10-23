import { SELF_TIMER_SECONDS } from "../hooks/useSelfTimer";

/**
 * Self-timer chip for the viewfinder's top-left corner (preview only — the
 * REC timer takes that corner once recording). Kept clear of the centre so
 * the crosshair is never covered.
 */
export function SelfTimerToggle({
  enabled,
  onToggle,
  disabled,
}: {
  enabled: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      data-testid="self-timer-toggle"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={enabled}
      // Name starts with the visible text so Voice Control's "tap Timer off" works.
      aria-label={`Timer ${enabled ? `${SELF_TIMER_SECONDS}s` : "off"}, ${SELF_TIMER_SECONDS} second self-timer`}
      className={`absolute top-4 left-4 h-11 px-3 inline-flex items-center gap-1 rounded-full font-display text-sm tracking-wider text-white transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:opacity-60 ${
        enabled ? "bg-brand-orange/90 shadow-[0_0_12px_rgba(255,107,0,0.4)]" : "bg-black/60 backdrop-blur-sm"
      }`}
    >
      {`TIMER ${enabled ? `${SELF_TIMER_SECONDS}S` : "OFF"}`}
    </button>
  );
}

/** Big 3-2-1 above the crosshair (top third), so the aim point stays visible. */
export function SelfTimerCountdown({ seconds }: { seconds: number }) {
  return (
    <div
      data-testid="self-timer-countdown"
      role="status"
      aria-live="assertive"
      className="absolute top-16 inset-x-0 flex justify-center pointer-events-none"
    >
      <span className="font-display text-6xl text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">{seconds}</span>
    </div>
  );
}
