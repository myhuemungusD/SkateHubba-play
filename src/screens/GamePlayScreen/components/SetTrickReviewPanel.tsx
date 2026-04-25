import { Btn } from "../../../components/ui/Btn";
import type { GameDoc } from "../../../services/games";
import { isFirebaseStorageUrl } from "../../../utils/helpers";

interface Props {
  game: GameDoc;
  setterUsername: string;
  matcherUsername: string;
  setReviewSubmitting: boolean;
  lastSetReviewAction: boolean | null;
  error: string;
  onRule: (clean: boolean) => void;
}

export function SetTrickReviewPanel({
  game,
  setterUsername,
  matcherUsername,
  setReviewSubmitting,
  lastSetReviewAction,
  error,
  onRule,
}: Props) {
  return (
    <div className="mt-5">
      <div className="text-center py-3 px-5 mb-5 rounded-2xl border bg-amber-500/[0.06] backdrop-blur-sm border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.06)]">
        <span className="font-display text-sm tracking-wider text-amber-400">CALL BS REVIEW</span>
        <p className="font-body text-sm text-muted mt-1">
          @{matcherUsername} called BS on @{setterUsername}&apos;s {game.currentTrickName || "trick"}. Rule clean or
          sketchy.
        </p>
      </div>

      {game.currentTrickVideoUrl && isFirebaseStorageUrl(game.currentTrickVideoUrl) ? (
        <div className="mb-4">
          <p className="font-display text-sm tracking-wider text-brand-orange mb-2">
            @{setterUsername.toUpperCase()}&apos;S SET
          </p>
          <video
            src={game.currentTrickVideoUrl}
            controls
            playsInline
            preload="metadata"
            aria-label={`${setterUsername}'s ${game.currentTrickName || "trick"} video`}
            className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
          />
        </div>
      ) : (
        <p className="font-body text-sm text-subtle text-center py-4 mb-4">
          No set video recorded — rule based on the claim.
        </p>
      )}

      {!setReviewSubmitting && !error && (
        <div role="group" aria-label="Rule clean or sketchy">
          <p className="font-display text-xl text-white text-center mb-4">Is the set clean?</p>
          <div className="flex gap-3">
            <Btn onClick={() => onRule(true)} variant="success" disabled={setReviewSubmitting}>
              Clean
            </Btn>
            <Btn onClick={() => onRule(false)} variant="danger" disabled={setReviewSubmitting}>
              Sketchy
            </Btn>
          </div>
        </div>
      )}
      {setReviewSubmitting && (
        <div className="text-center">
          <span className="font-display text-lg text-amber-400 tracking-wider animate-pulse">Ruling...</span>
        </div>
      )}
      {!setReviewSubmitting && error && lastSetReviewAction !== null && (
        <div className="mt-3">
          <Btn onClick={() => onRule(lastSetReviewAction)} variant="secondary">
            Retry
          </Btn>
        </div>
      )}
    </div>
  );
}
