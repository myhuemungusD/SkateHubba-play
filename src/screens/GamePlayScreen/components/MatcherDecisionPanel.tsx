import { UploadProgress } from "../../../components/UploadProgress";
import { Btn } from "../../../components/ui/Btn";
import type { UploadProgress as UploadProgressData } from "../../../services/storage";

interface Props {
  videoRecorded: boolean;
  submitting: boolean;
  error: string;
  uploadProgress: UploadProgressData | null;
  matcherLanded: boolean | null;
  submitMatchWithCall: (landed: boolean) => void;
}

export function MatcherDecisionPanel({
  videoRecorded,
  submitting,
  error,
  uploadProgress,
  matcherLanded,
  submitMatchWithCall,
}: Props) {
  return (
    <>
      {videoRecorded && !submitting && !error && (
        <div className="mt-5" role="group" aria-label="Did you land the trick?">
          {uploadProgress ? (
            <UploadProgress progress={uploadProgress} />
          ) : (
            <>
              <p className="font-display text-xl text-white text-center mb-4">Did you land it?</p>
              <div className="flex gap-3">
                <Btn onClick={() => submitMatchWithCall(true)} variant="success" disabled={submitting}>
                  ✓ Landed
                </Btn>
                <Btn onClick={() => submitMatchWithCall(false)} variant="danger" disabled={submitting}>
                  ✗ Missed
                </Btn>
              </div>
            </>
          )}
        </div>
      )}
      {submitting && !uploadProgress && (
        <div className="mt-5 text-center">
          <span className="font-display text-lg text-brand-green tracking-wider animate-pulse">Submitting...</span>
        </div>
      )}
      {!submitting && error && videoRecorded && matcherLanded !== null && (
        <div className="mt-5">
          <Btn onClick={() => submitMatchWithCall(matcherLanded)} variant="secondary">
            Retry
          </Btn>
        </div>
      )}
    </>
  );
}
