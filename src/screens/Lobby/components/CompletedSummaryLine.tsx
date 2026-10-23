import { RecordFigure } from "../../../components/RecordFigure";
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
        {/* Name comes from the visible text (axe label-content-name-mismatch). */}
        <span className="tabular-nums">
          {summary.total} finished ·{" "}
          <RecordFigure wins={summary.wins} games={summary.wins + summary.losses} caption="won" />
        </span>
        <span className="sr-only">. View record</span>
      </button>
    </p>
  );
}
