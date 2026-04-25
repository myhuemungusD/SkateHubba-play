import { UploadProgress } from "../../../components/UploadProgress";
import { Btn } from "../../../components/ui/Btn";
import type { UploadProgress as UploadProgressData } from "../../../services/storage";

interface Props {
  videoBlob: Blob | null;
  videoRecorded: boolean;
  submitting: boolean;
  error: string;
  uploadProgress: UploadProgressData | null;
  setterAction: "landed" | "missed" | null;
  opponentName: string;
  submitSetterTrick: (blob: Blob | null) => void;
  submitSetterMissed: () => void;
}

export function SetterDecisionPanel({
  videoBlob,
  videoRecorded,
  submitting,
  error,
  uploadProgress,
  setterAction,
  opponentName,
  submitSetterTrick,
  submitSetterMissed,
}: Props) {
  return (
    <>
      {videoRecorded && !submitting && !error && (
        <div className="mt-5" role="group" aria-label="Did you land the trick?">
          <p className="font-display text-xl text-white text-center mb-4">Did you land it?</p>
          <div className="flex gap-3">
            <Btn onClick={() => submitSetterTrick(videoBlob)} variant="success" disabled={submitting}>
              ✓ Landed
            </Btn>
            <Btn onClick={submitSetterMissed} variant="danger" disabled={submitting}>
              ✗ Missed
            </Btn>
          </div>
        </div>
      )}
      {submitting && (
        <div className="mt-5 text-center">
          {uploadProgress ? (
            <UploadProgress progress={uploadProgress} />
          ) : (
            <span className="font-display text-lg text-brand-orange tracking-wider animate-pulse">
              {setterAction === "missed" ? "Passing turn..." : `Sending to @${opponentName}...`}
            </span>
          )}
        </div>
      )}
      {!submitting && error && videoRecorded && (
        <div className="mt-5">
          <Btn
            onClick={setterAction === "missed" ? submitSetterMissed : () => submitSetterTrick(videoBlob)}
            variant="secondary"
          >
            Retry
          </Btn>
        </div>
      )}
    </>
  );
}
