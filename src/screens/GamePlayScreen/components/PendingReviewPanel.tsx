import { Btn } from "../../../components/ui/Btn";
import { Timer } from "../../../components/Timer";
import type { GameDoc } from "../../../services/games";
import { isFirebaseStorageUrl } from "../../../utils/helpers";

interface Props {
  game: GameDoc;
  matcherUsername: string;
  /** False once the claim can no longer be escalated — hides the Dispute button. */
  canDispute: boolean;
  /** Review-window countdown; on expiry the claim auto-accepts server-side. */
  deadline: number;
  submitting: boolean;
  lastReviewAction: "accept" | "dispute" | null;
  error: string;
  onAccept: () => void;
  onDispute: () => void;
}

/**
 * Setter-facing surface for a frozen landed claim (pendingReview).
 *
 * The opponent has claimed they matched the trick; the game is frozen until
 * this player either ACCEPTS the honor call (deferred swap, no letter) or
 * DISPUTES it to the community (binding crowd vote). The countdown is the 24h
 * accept window — if it lapses the dispute referee auto-accepts the claim and
 * the game advances on its own, so this screen is never a dead end.
 */
export function PendingReviewPanel({
  game,
  matcherUsername,
  canDispute,
  deadline,
  submitting,
  lastReviewAction,
  error,
  onAccept,
  onDispute,
}: Props) {
  const attemptUrl = game.matchVideoUrl && isFirebaseStorageUrl(game.matchVideoUrl) ? game.matchVideoUrl : null;

  return (
    <div className="mt-5">
      <div className="text-center py-3 px-5 mb-5 rounded-2xl border bg-amber-500/[0.06] backdrop-blur-sm border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.06)]">
        <span className="font-display text-sm tracking-wider text-amber-400">THEY CLAIM THEY LANDED</span>
        <p className="font-body text-sm text-muted mt-1">
          @{matcherUsername} says they matched your {game.currentTrickName || "trick"}. Watch it, then accept the call
          or send it to the community.
        </p>
      </div>

      <div className="flex justify-center mb-4">
        <Timer deadline={deadline} />
      </div>
      <p className="font-body text-xs text-faint text-center mb-4">
        If you don&apos;t decide in time, the claim is accepted automatically and the game continues.
      </p>

      {attemptUrl ? (
        <div className="mb-5">
          <p className="font-display text-sm tracking-wider text-brand-green mb-2">
            @{matcherUsername.toUpperCase()}&apos;S ATTEMPT
          </p>
          <video
            src={attemptUrl}
            controls
            playsInline
            preload="metadata"
            aria-label={`${matcherUsername}'s match attempt video`}
            className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
          />
        </div>
      ) : (
        <p className="font-body text-sm text-subtle text-center py-4 mb-4">No match video was recorded.</p>
      )}

      {submitting ? (
        <div className="text-center">
          <span className="font-display text-lg text-amber-400 tracking-wider animate-pulse">
            {lastReviewAction === "dispute" ? "Sending to the community..." : "Accepting..."}
          </span>
        </div>
      ) : (
        <>
          {!error && (
            <div role="group" aria-label="Accept the landed claim or dispute it">
              <div className="flex gap-3">
                <Btn onClick={onAccept} variant="success">
                  Accept
                </Btn>
                {canDispute && (
                  <Btn onClick={onDispute} variant="danger">
                    Dispute
                  </Btn>
                )}
              </div>
              {canDispute && (
                <p className="font-body text-xs text-faint text-center mt-3">
                  Dispute hands the call to the community — their majority vote is binding.
                </p>
              )}
            </div>
          )}
          {error && lastReviewAction !== null && (
            <div className="mt-3">
              <Btn onClick={lastReviewAction === "dispute" ? onDispute : onAccept} variant="secondary">
                Retry
              </Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
}
