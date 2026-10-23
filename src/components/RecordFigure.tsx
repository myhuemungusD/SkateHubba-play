import { formatRecord } from "../constants/stats";

interface Props {
  wins: number | undefined;
  games: number | undefined;
  /** Small muted word after the numbers, e.g. "won". Visual only. */
  caption?: string;
  className?: string;
  testId?: string;
}

/**
 * Shows a record as "wins / games" (e.g. "2 / 4"). Sighted users get the two
 * numbers; screen readers get the explicit "2 wins out of 4 games".
 */
export function RecordFigure({ wins, games, caption, className = "", testId }: Props) {
  const r = formatRecord(wins, games);
  return (
    <span className={`tabular-nums ${className}`} data-testid={testId} title={r.label}>
      <span aria-hidden="true">
        {r.text}
        {caption && <span className="text-subtle"> {caption}</span>}
      </span>
      <span className="sr-only">{r.label}</span>
    </span>
  );
}
