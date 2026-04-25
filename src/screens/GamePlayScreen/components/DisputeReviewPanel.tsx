import { Btn } from "../../../components/ui/Btn";
import type { GameDoc } from "../../../services/games";
import { isFirebaseStorageUrl } from "../../../utils/helpers";

interface Props {
  game: GameDoc;
  setterUsername: string;
  matcherUsername: string;
  disputeSubmitting: boolean;
  lastDisputeAction: boolean | null;
  error: string;
  onResolve: (accept: boolean) => void;
}

export function DisputeReviewPanel({
  game,
  setterUsername,
  matcherUsername,
  disputeSubmitting,
  lastDisputeAction,
  error,
  onResolve,
}: Props) {
  return (
    <div className="mt-5">
      <div className="text-center py-3 px-5 mb-5 rounded-2xl border bg-amber-500/[0.06] backdrop-blur-sm border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.06)]">
        <span className="font-display text-sm tracking-wider text-amber-400">REFEREE&apos;S CALL</span>
        <p className="font-body text-sm text-muted mt-1">
          @{matcherUsername} claims they landed @{setterUsername}&apos;s {game.currentTrickName || "trick"}. Watch both
          videos and rule.
        </p>
      </div>

      {game.currentTrickVideoUrl && isFirebaseStorageUrl(game.currentTrickVideoUrl) && (
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
      )}

      {game.matchVideoUrl && isFirebaseStorageUrl(game.matchVideoUrl) && (
        <div className="mb-4">
          <p className="font-display text-sm tracking-wider text-brand-green mb-2">
            @{matcherUsername.toUpperCase()}&apos;S ATTEMPT
          </p>
          <video
            src={game.matchVideoUrl}
            controls
            playsInline
            preload="metadata"
            aria-label={`${matcherUsername}'s match attempt video`}
            className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
          />
        </div>
      )}

      {!game.currentTrickVideoUrl && !game.matchVideoUrl && (
        <p className="font-body text-sm text-subtle text-center py-4 mb-4">
          No videos recorded — rule based on the claim.
        </p>
      )}

      {!disputeSubmitting && !error && (
        <div role="group" aria-label="Rule landed or missed">
          <p className="font-display text-xl text-white text-center mb-4">Did they land it?</p>
          <div className="flex gap-3">
            <Btn onClick={() => onResolve(true)} variant="success" disabled={disputeSubmitting}>
              Landed
            </Btn>
            <Btn onClick={() => onResolve(false)} variant="danger" disabled={disputeSubmitting}>
              Missed
            </Btn>
          </div>
        </div>
      )}
      {disputeSubmitting && (
        <div className="text-center">
          <span className="font-display text-lg text-amber-400 tracking-wider animate-pulse">Resolving...</span>
        </div>
      )}
      {!disputeSubmitting && error && lastDisputeAction !== null && (
        <div className="mt-3">
          <Btn onClick={() => onResolve(lastDisputeAction)} variant="secondary">
            Retry
          </Btn>
        </div>
      )}
    </div>
  );
}
