import type { CompletedSummary } from "../useLobbyController";

interface Props {
  summary: CompletedSummary;
  onViewRecord: () => void;
}

/** Finished games collapse to one line. The full history already lives on the
 *  viewer's own profile screen, so this links there instead of listing cards. */
export function CompletedSummaryLine({ summary, onViewRecord }: Props) {
  if (summary.total === 0) return null;

  return (
    <p className="mb-6 font-body text-xs text-muted">
      <button
        type="button"
        onClick={onViewRecord}
        className="min-h-[44px] inline-flex items-center gap-1.5 px-2 -mx-2 rounded-md text-muted hover:text-white transition-colors duration-300 underline underline-offset-4 decoration-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      >
        <span className="tabular-nums">
          {summary.total} finished · {summary.wins}–{summary.losses}
        </span>
      </button>
    </p>
  );
}
