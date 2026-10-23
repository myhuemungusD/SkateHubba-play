import { Timer } from "../../../components/Timer";
import { BackChevron } from "../../../components/ScreenHeader";

interface Props {
  deadline: number;
  isPlayer: boolean;
  reported: boolean;
  /** False when the screen body already shows the same countdown. */
  showTimer?: boolean;
  onBack: () => void;
  onReport: () => void;
}

export function GamePlayHeader({ deadline, isPlayer, reported, showTimer = true, onBack, onReport }: Props) {
  return (
    <div className="px-5 pt-safe pb-4 border-b border-white/[0.04] glass flex justify-between items-center gap-2">
      <BackChevron onClick={onBack} label="Back to games" />
      <img
        src="/logonew.webp"
        alt=""
        draggable={false}
        className="h-5 w-auto select-none opacity-40"
        aria-hidden="true"
      />
      <div className="flex items-center gap-1">
        {showTimer && <Timer deadline={deadline} />}
        {isPlayer && (
          <button
            type="button"
            onClick={onReport}
            disabled={reported}
            aria-label={reported ? "Reported" : "Report opponent"}
            title={reported ? "Already reported" : "Report opponent"}
            className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 font-body text-sm text-bright hover:text-brand-red transition-colors duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {reported ? "Reported" : "Report"}
          </button>
        )}
      </div>
    </div>
  );
}
