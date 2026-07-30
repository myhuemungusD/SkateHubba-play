import { Btn } from "../ui/Btn";
import { DisputeCard } from "./DisputeCard";
import { useDisputeLaneController } from "./useDisputeLaneController";
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

/**
 * The top lane of the lobby feed: tricks whose landing is in dispute,
 * waiting on the crowd.
 *
 * Sits ABOVE the community clip spotlight because it is the only part of the
 * feed with a decision attached — everything below it is browsing. A dispute
 * the viewer has already ruled on stays in the lane showing its tally rather
 * than vanishing, so a call feels recorded rather than swallowed.
 *
 * Renders nothing at all when there are no open disputes: an empty-state card
 * here would push the spotlight down the page to announce an absence.
 */
export function DisputeLane({ viewerUid }: { viewerUid: string }) {
  const c = useDisputeLaneController(viewerUid);

  if (c.loading) {
    return (
      <div className="mb-6" role="status" aria-busy="true" aria-label="Loading community calls">
        <div className="h-3 w-28 rounded-md bg-surface-alt animate-pulse mb-3" />
        <div className="h-16 w-full rounded-2xl bg-surface-alt/60 border border-border animate-pulse" />
        <span className="sr-only">Loading community calls…</span>
      </div>
    );
  }

  if (c.error) {
    return (
      <div className="glass-card rounded-2xl p-4 mb-6 border border-brand-red/30">
        <p className="font-body text-sm text-white/80 mb-3">{c.error}</p>
        <Btn onClick={c.reload} variant="secondary">
          Try again
        </Btn>
      </div>
    );
  }

  if (c.disputes.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-display text-[11px] tracking-[0.2em] text-amber-400">SETTLE IT</h3>
        <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 font-display text-[10px] text-amber-400 leading-none tabular-nums">
          {c.disputes.length}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {c.disputes.map((dispute) => {
          const viewer = c.viewerFor(dispute.id);
          return (
            <DisputeCard
              key={dispute.id}
              dispute={dispute}
              tally={c.tallyFor(dispute.id)}
              ownVerdict={viewer.ownVerdict}
              canVote={viewer.canVote}
              voting={c.isVoting(dispute.id)}
              deadline={voteDeadline(dispute)}
              onVerdict={c.handleVerdict}
            />
          );
        })}
      </div>
    </div>
  );
}
