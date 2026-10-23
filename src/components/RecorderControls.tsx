import { Btn } from "./ui/Btn";
import { CameraIcon, RecordIcon, StopIcon } from "./icons";

/**
 * Seconds of lead-in for the "Auto-stop in Ns" warning. The old 60s cap warned
 * 10s out; at the shared 20s cap that same absolute lead-in would nag for half
 * the take, so it scales down with the cap.
 */
const AUTO_STOP_WARNING_SECONDS = 5;

/** Open / Record / Stop / Retry buttons and the done badge under the viewfinder. */
export function RecorderControls({
  state,
  cameraError,
  label,
  doneLabel,
  seconds,
  secondsLeft,
  maxDurationSeconds,
  countdown = null,
  recordBlockedLabel,
  onOpen,
  onStart,
  onCancelCountdown,
  onStop,
  onRetry,
}: {
  state: string;
  cameraError: string | null;
  label: string;
  doneLabel?: string;
  seconds: number;
  secondsLeft: number;
  maxDurationSeconds: number;
  /** Seconds left on a running self-timer; Record becomes Cancel meanwhile. */
  countdown?: number | null;
  /** Preview stays live but Record is disabled with this copy (e.g. no trick picked yet). */
  recordBlockedLabel?: string;
  onOpen: () => void;
  onStart: () => void;
  onCancelCountdown?: () => void;
  onStop: () => void;
  onRetry: () => void;
}) {
  return (
    <>
      {cameraError && doneLabel === undefined && (
        <Btn onClick={onRetry} variant="secondary">
          Retry Camera
        </Btn>
      )}
      {state === "idle" && !cameraError && (
        <Btn onClick={onOpen} variant="secondary">
          <CameraIcon size={16} className="inline -mt-0.5" /> Open Camera
        </Btn>
      )}
      {state === "preview" && countdown !== null && (
        <Btn onClick={onCancelCountdown} variant="secondary" className="text-2xl py-5">
          Cancel — recording in {countdown}
        </Btn>
      )}
      {state === "preview" && countdown === null && (
        <Btn onClick={onStart} variant="danger" className="text-2xl py-5" disabled={recordBlockedLabel !== undefined}>
          <RecordIcon size={16} className="inline -mt-0.5" /> {recordBlockedLabel ?? `Record — ${label}`}
        </Btn>
      )}
      {state === "recording" && (
        <>
          <Btn onClick={onStop} variant="danger" className="text-2xl py-5 animate-rec-ring">
            <StopIcon size={16} className="inline -mt-0.5" /> Stop Recording
          </Btn>
          {seconds >= maxDurationSeconds - AUTO_STOP_WARNING_SECONDS && secondsLeft > 0 && (
            <span className="font-body text-xs text-brand-red animate-pulse">Auto-stop in {secondsLeft}s</span>
          )}
        </>
      )}
      {state === "done" && doneLabel && (
        <div className="flex items-center gap-2 px-5 py-3 rounded-xl bg-[rgba(0,230,118,0.08)] border border-brand-green">
          <span className="text-brand-green font-display text-lg tracking-wider">✓ {doneLabel}</span>
        </div>
      )}
    </>
  );
}
