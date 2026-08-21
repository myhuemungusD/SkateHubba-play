import type { MatchResult } from "../usePlayerProfileController";

/**
 * Compact form guide — the player's last ten results as W/L pips, oldest
 * first (the order the server writes them in).
 *
 * Renders nothing when the run is empty. A profile predating the
 * `recentResults` counter has no form to report, and ten blank pips would
 * read as ten losses.
 *
 * The pip row is a single `role="img"` with a summarising label so screen
 * readers announce "Last 10 games: 6 wins, 4 losses" instead of walking ten
 * unlabelled spans. Green marks a win; a loss is a neutral surface, not red —
 * this is a public profile, and the design language reserves colour for
 * things worth celebrating.
 */
export function LastTenPips({ results }: { results: MatchResult[] }) {
  if (results.length === 0) return null;

  const wins = results.filter((r) => r === "W").length;
  const losses = results.length - wins;
  const summary = `${wins} ${wins === 1 ? "win" : "wins"}, ${losses} ${losses === 1 ? "loss" : "losses"}`;

  return (
    <div
      data-testid="last-ten-row"
      className="rounded-xl bg-surface border border-white/[0.06] shadow-card p-3 mb-2 animate-fade-in"
    >
      <div
        role="img"
        aria-label={`Last ${results.length} games: ${summary}`}
        className="flex flex-wrap items-center gap-1.5"
      >
        {results.map((result, i) => (
          <span
            key={`${i}-${result}`}
            aria-hidden="true"
            className={`inline-flex h-5 w-5 items-center justify-center rounded-full border font-display text-[10px] leading-none ${
              result === "W"
                ? "bg-brand-green/15 border-brand-green/30 text-brand-green"
                : "bg-white/[0.04] border-white/[0.08] text-subtle"
            }`}
          >
            {result}
          </span>
        ))}
      </div>
      <p className="font-body text-[10px] uppercase tracking-wider text-subtle mt-2.5">
        Last {results.length} — oldest first
      </p>
    </div>
  );
}
