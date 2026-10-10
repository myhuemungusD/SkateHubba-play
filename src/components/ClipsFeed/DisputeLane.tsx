import { Btn } from "../ui/Btn";
import { DisputeCard } from "./DisputeCard";
import { FEED_SLIDE } from "./feedLayout";
import { useDisputeLaneController, type DisputeLaneController } from "./useDisputeLaneController";
import { TURN_DURATION_MS } from "../../services/turnDuration";
import type { Dispute } from "../../types/dispute";

/**
 * The community vote window closes 24h after the dispute was raised. The
 * dispute doc carries no explicit deadline field (that lives on the frozen
 * game, which non-players can't read), so it's derived from `createdAt` — the
 * same instant `raiseDispute` stamps the game's `reviewDeadline`. Null when the
 * server timestamp hasn't resolved yet (offline write), so the card omits it.
 */
function voteDeadline(dispute: Dispute): number | null {
  const created = dispute.createdAt?.toMillis?.();
  return created ? created + TURN_DURATION_MS : null;
}

export interface DisputeSlidesProps {
  state: DisputeLaneController;
  /** Index of the snapped page in the combined feed. Disputes occupy 0..n-1. */
  activeIndex?: number;
  muted?: boolean;
  onToggleMute?: () => void;
}

/**
 * Open disputes as snap pages. Renders nothing when there are none — an empty
 * page here would be a blank swipe before the clips. Loading and failure
 * take a single page so the call is never a silent miss.
 */
export function DisputeSlides({ state, activeIndex = 0, muted, onToggleMute }: DisputeSlidesProps) {
  if (state.loading) {
    return (
      <div
        data-feed-slide
        className={`${FEED_SLIDE} flex items-center justify-center`}
        role="status"
        aria-busy="true"
        aria-label="Loading community calls"
      >
        <span className="sr-only">Loading community calls…</span>
      </div>
    );
  }

  if (state.error) {
    return (
      <div data-feed-slide className={`${FEED_SLIDE} flex items-center justify-center px-6`}>
        <div className="glass-card w-full max-w-sm rounded-2xl border border-brand-red/30 p-4">
          <p className="mb-3 font-body text-sm text-white/80">{state.error}</p>
          <Btn onClick={state.reload} variant="secondary">
            Try again
          </Btn>
        </div>
      </div>
    );
  }

  if (state.disputes.length === 0) return null;

  return (
    <>
      {state.disputes.map((dispute, index) => {
        const viewer = state.viewerFor(dispute.id);
        return (
          <DisputeCard
            key={dispute.id}
            dispute={dispute}
            tally={state.tallyFor(dispute.id)}
            ownVerdict={viewer.ownVerdict}
            canVote={viewer.canVote}
            voting={state.isVoting(dispute.id)}
            deadline={voteDeadline(dispute)}
            onVerdict={state.handleVerdict}
            active={index === activeIndex}
            near={Math.abs(index - activeIndex) <= 1}
            muted={muted}
            onToggleMute={onToggleMute}
          />
        );
      })}
    </>
  );
}

/**
 * Standalone entry used by the dispute lane tests. The feed mounts
 * {@link DisputeSlides} itself so disputes and clips share one scroller.
 */
export function DisputeLane({ viewerUid }: { viewerUid: string }) {
  const state = useDisputeLaneController(viewerUid);
  return <DisputeSlides state={state} />;
}
