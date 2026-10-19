import { isTurnLengthHours, turnLengthLabel } from "../services/turnDuration";

/**
 * "3-day turns" pill for games that carry a chosen turn length. Driven by the
 * game doc rather than the VITE_FEATURE_TURN_LENGTH flag: a player who never
 * had the picker still needs to see that their opponent picked a longer clock.
 * Renders nothing for legacy games (no field), which all play 24h turns.
 */
export function TurnLengthChip({ hours, className = "" }: { hours: unknown; className?: string }) {
  if (!isTurnLengthHours(hours)) return null;
  return (
    <span
      data-testid="turn-length-chip"
      className={`inline-flex items-center rounded-full border border-white/[0.08] px-2 py-0.5 font-body text-xs text-bright shrink-0 ${className}`}
    >
      {turnLengthLabel(hours)}
    </span>
  );
}
