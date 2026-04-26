import { Timer } from "../../../components/Timer";

interface Props {
  deadline: number;
  isPlayer: boolean;
  reported: boolean;
  onBack: () => void;
  onReport: () => void;
}

export function GamePlayHeader({ deadline, isPlayer, reported, onBack, onReport }: Props) {
  return (
    <div className="px-5 pt-safe pb-4 border-b border-white/[0.04] glass flex justify-between items-center">
      <button
        type="button"
        onClick={onBack}
        className="font-body text-sm text-muted hover:text-white transition-colors duration-300 rounded-lg py-1 px-1 -ml-1"
      >
        ← Games
      </button>
      <img src="/logo.webp" alt="" draggable={false} className="h-5 w-auto select-none opacity-40" aria-hidden="true" />
      <div className="flex items-center gap-3">
        <Timer deadline={deadline} />
        {isPlayer && (
          <button
            type="button"
            onClick={onReport}
            disabled={reported}
            aria-label="Report opponent"
            title={reported ? "Already reported" : "Report opponent"}
            className="font-body text-xs text-subtle hover:text-brand-red transition-colors duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {reported ? "Reported" : "Flag"}
          </button>
        )}
      </div>
    </div>
  );
}
