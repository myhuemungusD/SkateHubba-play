import { Btn } from "../ui/Btn";
import type { NudgeStatus } from "./useWaitingScreen";

interface WaitingActionsProps {
  showNudge: boolean;
  nudgeStatus: NudgeStatus;
  nudgeError: string;
  nudgeAvailable: boolean;
  onNudge: () => void | Promise<void>;
  onBack: () => void;
  showReportLink: boolean;
  reported: boolean;
  onOpenReport: () => void;
}

export function WaitingActions({
  showNudge,
  nudgeStatus,
  nudgeError,
  nudgeAvailable,
  onNudge,
  onBack,
  showReportLink,
  reported,
  onOpenReport,
}: WaitingActionsProps) {
  return (
    <>
      {showNudge && (
        <div className="mt-6">
          <Btn onClick={onNudge} variant="secondary" disabled={nudgeStatus === "pending" || !nudgeAvailable}>
            {nudgeStatus === "sent" ? "Nudge Sent" : nudgeStatus === "pending" ? "Nudging..." : "Nudge"}
          </Btn>
          {nudgeError && <p className="font-body text-xs text-brand-red mt-2 text-center">{nudgeError}</p>}
          {nudgeStatus === "sent" && (
            <p className="font-body text-xs text-muted mt-2 text-center">They&apos;ll get a push notification</p>
          )}
          {!nudgeAvailable && nudgeStatus !== "sent" && (
            <p className="font-body text-xs text-faint mt-2 text-center">Nudge available every hour</p>
          )}
        </div>
      )}

      <div className="mt-8 flex flex-col items-center gap-2">
        <Btn onClick={onBack} variant="ghost">
          ← Back to Games
        </Btn>
        {showReportLink && (
          <button
            type="button"
            onClick={onOpenReport}
            disabled={reported}
            className="touch-target inline-flex items-center justify-center font-body text-xs text-subtle hover:text-brand-red transition-colors duration-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red"
          >
            {reported ? "Reported" : "Report opponent"}
          </button>
        )}
      </div>
    </>
  );
}
