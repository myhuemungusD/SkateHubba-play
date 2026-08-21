/**
 * Barrel re-export for the community-dispute service. Implementation lives in:
 *   - disputes.mappers.ts — types, refs, DTO mapping
 *   - disputes.raise.ts   — setter-facing trigger (transactional create)
 *   - disputes.feed.ts    — open-dispute feed query
 *   - disputes.votes.ts   — verdict write + per-page viewer-state hydration
 *   - disputes.cascade.ts — account-deletion cascade
 *
 * SCOPE: this iteration RECORDS AND TALLIES ONLY. Raising a dispute and
 * ruling on one never write letters, never advance a turn, and never touch
 * the game doc's `phase`/`currentTurn`/`turnHistory`. The turn resolves on
 * the honor system exactly as it does today; the crowd verdict is display
 * data. Making it binding needs its own transactional close-out path and
 * rules work — see the note in `src/types/dispute.ts`.
 */

export type {
  Dispute,
  DisputeModerationStatus,
  DisputeStatus,
  DisputeTally,
  DisputeVerdict,
  DisputeViewerState,
  DisputeVote,
} from "./disputes.mappers";

export { canRaiseDispute, raiseDispute } from "./disputes.raise";

export { fetchOpenDisputes } from "./disputes.feed";
export { fetchResolvedDispute } from "./disputes.resolved";

export {
  AlreadyRuledError,
  DisputeClosedError,
  OwnDisputeError,
  castDisputeVerdict,
  fetchDisputeViewerState,
} from "./disputes.votes";

export { deleteUserDisputeVotes, deleteUserDisputes } from "./disputes.cascade";
