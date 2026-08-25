import { Timer } from "../../../components/Timer";
import { GavelIcon, HourglassIcon } from "../../../components/icons";
import { landShare, totalVotes, type Dispute, type DisputeTally } from "../../../types/dispute";
import type { CommunityDisputeState } from "../useCommunityDispute";

type ReviewKind = "pending-matcher" | "community";

interface Props {
  kind: ReviewKind;
  /** The other player — named in the matcher's "waiting on them" copy. */
  opponentUsername: string;
  /** Live review-window countdown (accept window or community vote window). */
  deadline: number;
  dispute?: Dispute | null;
  disputeState?: CommunityDisputeState;
}

/**
 * Read-only surface for a frozen review the viewer can't act on:
 *
 *  • `pending-matcher` — the claimer waiting for the setter to accept or
 *    dispute their landed claim (pendingReview).
 *  • `community` — either player while the dispute is out to the crowd
 *    (communityReview).
 *
 * No game actions exist in either state — the game is frozen until the setter
 * decides or the community (or the referee, on expiry) resolves it — so this
 * panel is purely informational, mirroring the waiting-screen chrome.
 */
export function ReviewStatusPanel({ kind, opponentUsername, deadline, dispute, disputeState = "loading" }: Props) {
  const community = kind === "community";
  const tally: DisputeTally | null = dispute ? { land: dispute.landVotes, bail: dispute.bailVotes } : null;
  const total = tally ? totalVotes(tally) : 0;
  return (
    <div className="mt-5 text-center py-6 px-5 rounded-2xl border bg-amber-500/[0.06] backdrop-blur-sm border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.06)]">
      <div className="flex justify-center mb-3">
        {community ? (
          <GavelIcon size={40} className="text-amber-400" />
        ) : (
          <HourglassIcon size={40} className="text-amber-400" />
        )}
      </div>
      <span className="font-display text-sm tracking-wider text-amber-400">
        {community ? "UNDER COMMUNITY REVIEW" : "AWAITING THEIR CALL"}
      </span>
      <p className="font-body text-sm text-muted mt-2 mb-4">
        {community
          ? "The community is deciding whether this trick was landed. Nobody plays until the votes are in."
          : `Waiting for @${opponentUsername} to accept or dispute your landed claim.`}
      </p>

      <div className="flex justify-center mb-3">
        <Timer deadline={deadline} />
      </div>

      {community && tally && (
        <div className="mb-4" aria-label="Community vote tally">
          <div className="flex items-center justify-between font-display text-xs tracking-[0.15em] tabular-nums">
            <span className="text-brand-green">LAND {tally.land}</span>
            <span className="text-faint">{total} TOTAL</span>
            <span className="text-brand-red">{tally.bail} BAIL</span>
          </div>
          <div
            role="img"
            aria-label={`${tally.land} land, ${tally.bail} bail — ${total} ${total === 1 ? "vote" : "votes"} total`}
            className="mt-2 h-2 w-full overflow-hidden rounded-full border border-white/[0.06] bg-brand-red/40"
          >
            <div
              className="h-full bg-brand-green motion-safe:transition-[width] motion-safe:duration-500 ease-smooth"
              style={{ width: `${landShare(tally) * 100}%` }}
            />
          </div>
        </div>
      )}

      {community && disputeState !== "ready" && disputeState !== "closed" && (
        <p role="status" className="font-body text-xs text-faint mb-4">
          {disputeState === "loading"
            ? "Loading the current vote count…"
            : disputeState === "missing"
              ? "The vote count is not available yet."
              : disputeState === "denied"
                ? "You don't have permission to view the vote count."
                : "The vote count is temporarily unavailable."}
        </p>
      )}
      {community && disputeState === "closed" && (
        <p role="status" className="font-body text-xs text-faint mb-4">
          Voting has closed. Showing the final count.
        </p>
      )}

      <p className="font-body text-xs text-faint">
        {community
          ? "The majority call decides it — a tie sends the trick back for a re-attempt."
          : "If they don't decide in time, your claim is accepted automatically."}
      </p>
    </div>
  );
}
