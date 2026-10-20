interface MatchResultProps {
  title: string;
  reason: string;
  /** "5 – 3"; null when no match was played. */
  score: string | null;
  won: boolean;
  /** Your Rep change for this match, when it moved. */
  repDelta: number | null;
  repAfter: number | null;
}

/** The end of a match: plain result, final score, and the Rep it moved. */
export function MatchResult({ title, reason, score, won, repDelta, repAfter }: MatchResultProps) {
  return (
    <section
      aria-labelledby="dice-result-title"
      data-testid="dice-result"
      className="dice-rise relative overflow-hidden rounded-2xl border border-white/[0.08] bg-surface px-5 py-5"
    >
      <div aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${won ? "bg-brand-orange" : "bg-white/20"}`} />
      <h2
        id="dice-result-title"
        className={`font-display text-4xl tracking-wider ${won ? "text-brand-orange" : "text-white"}`}
      >
        {title}
      </h2>
      <p className="mt-1 font-body text-sm text-bright">{reason}</p>
      {score || repDelta !== null ? (
        <dl className="mt-4 flex gap-6">
          {score ? (
            <div>
              <dt className="font-display text-xs tracking-[0.18em] text-muted">Final</dt>
              <dd className="font-display text-2xl tabular-nums text-white">{score}</dd>
            </div>
          ) : null}
          {repDelta !== null ? (
            <div>
              <dt className="font-display text-xs tracking-[0.18em] text-muted">Rep</dt>
              <dd className="font-display text-2xl tabular-nums text-white">
                <span className={repDelta >= 0 ? "text-brand-green" : "text-brand-red"}>
                  {repDelta >= 0 ? "+" : "−"}
                  {Math.abs(repDelta)}
                </span>
                {repAfter !== null ? (
                  <span className="ml-2 text-base text-muted">{repAfter.toLocaleString("en-US")}</span>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}
