import { useState, useCallback, useRef } from "react";
import { submitJuryVote, type DisputeDoc } from "../services/disputes";
import { isFirebaseStorageUrl } from "../utils/helpers";
import { Btn } from "./ui/Btn";
import { ErrorBanner } from "./ui/ErrorBanner";

export function DisputeReview({
  dispute,
  currentUid,
  onVoted,
}: {
  dispute: DisputeDoc;
  currentUid: string;
  onVoted?: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [voted, setVoted] = useState(false);
  const submittedRef = useRef(false);

  const handleVote = useCallback(
    async (landed: boolean) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      setError("");
      try {
        await submitJuryVote(dispute.id, currentUid, landed);
        setVoted(true);
        onVoted?.();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to submit vote");
        submittedRef.current = false;
      } finally {
        setSubmitting(false);
      }
    },
    [dispute.id, currentUid, onVoted],
  );

  if (voted) {
    return (
      <div className="rounded-xl border border-border bg-surface-alt p-5 text-center">
        <p className="font-display text-lg text-purple-400">Vote submitted — thanks for judging!</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface-alt p-5">
      <div className="text-center mb-4">
        <p className="font-display text-sm tracking-wider text-red-400 mb-1">DISPUTE</p>
        <p className="font-display text-lg text-white">{dispute.trickName}</p>
        <p className="font-body text-xs text-[#888] mt-1">
          @{dispute.setterUsername} says {dispute.setterVote ? "landed" : "missed"} &middot; @{dispute.matcherUsername}{" "}
          says {dispute.matcherVote ? "landed" : "missed"}
        </p>
      </div>

      {/* Setter's clip */}
      <div className="mb-4">
        <p className="font-display text-xs tracking-wider text-brand-orange mb-1">
          @{dispute.setterUsername}&apos;s TRICK
        </p>
        {dispute.setVideoUrl && isFirebaseStorageUrl(dispute.setVideoUrl) ? (
          <video
            src={dispute.setVideoUrl}
            controls
            playsInline
            preload="metadata"
            aria-label={`Setter video for ${dispute.trickName}`}
            className="w-full max-w-[320px] mx-auto aspect-[9/16] rounded-xl bg-black object-cover border border-border"
          />
        ) : (
          <p className="font-body text-xs text-[#555] text-center py-2">No video</p>
        )}
      </div>

      {/* Matcher's clip */}
      <div className="mb-4">
        <p className="font-display text-xs tracking-wider text-brand-green mb-1">
          @{dispute.matcherUsername}&apos;s ATTEMPT
        </p>
        {dispute.matchVideoUrl && isFirebaseStorageUrl(dispute.matchVideoUrl) ? (
          <video
            src={dispute.matchVideoUrl}
            controls
            playsInline
            preload="metadata"
            aria-label={`Matcher video for ${dispute.trickName}`}
            className="w-full max-w-[320px] mx-auto aspect-[9/16] rounded-xl bg-black object-cover border border-border"
          />
        ) : (
          <p className="font-body text-xs text-[#555] text-center py-2">No video</p>
        )}
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      {!submitting && (
        <div role="group" aria-label="Did the matcher land the trick?">
          <p className="font-display text-base text-white text-center mb-3">Your call — did they land it?</p>
          <div className="flex gap-3">
            <Btn onClick={() => handleVote(true)} variant="success" disabled={submitting}>
              ✓ Landed
            </Btn>
            <Btn onClick={() => handleVote(false)} variant="danger" disabled={submitting}>
              ✗ Missed
            </Btn>
          </div>
        </div>
      )}

      {submitting && (
        <div className="text-center">
          <span className="font-display text-lg text-purple-400 tracking-wider animate-pulse">Submitting...</span>
        </div>
      )}

      <p className="font-body text-xs text-[#555] text-center mt-3">{dispute.jurySize} of 3 jury votes cast</p>
    </div>
  );
}
