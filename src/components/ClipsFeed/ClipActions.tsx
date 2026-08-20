import { memo } from "react";
import type { ClipDoc } from "../../services/clips";
import type { ClipVoteState } from "../../services/clips.upvotes";
import { ChevronRightIcon, FlagIcon, ThumbsDownIcon, ThumbsUpIcon } from "../icons";

export interface ClipActionsProps {
  clip: ClipDoc;
  isOwnClip: boolean;
  vote: ClipVoteState;
  /** True while this clip's vote write is in flight — locks both thumbs. */
  voting: boolean;
  onUpvote: (clip: ClipDoc) => void;
  onDownvote: (clip: ClipDoc) => void;
  onChallenge: (username: string) => void;
  onReport: (clip: ClipDoc) => void;
  onComments: (clip: ClipDoc) => void;
}

/** Shared chrome for the two thumb buttons — only the accent colour differs. */
const THUMB_BASE =
  "min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl px-3 border transition-all duration-300 ease-smooth focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.97]";

/**
 * Action row under a community clip: thumbs up / thumbs down, comments,
 * challenge, report.
 *
 * Both thumbs are real, persisted tallies — the clip carries an
 * `upvoteCount` AND a `downvoteCount`, and each is shown next to its own
 * control. They are two faces of a single vote: a viewer holds at most one,
 * so tapping the thumb you already gave withdraws it (hence `aria-pressed`)
 * and tapping the other flips it. Neither one hides the clip; NEXT TRICK is
 * how you move on.
 *
 * On your own clip both controls are disabled rather than hidden — the counts
 * are the point of looking, and a row that changes shape depending on whose
 * clip it is reads as a bug.
 */
export const ClipActions = memo(function ClipActions({
  clip,
  isOwnClip,
  vote,
  voting,
  onUpvote,
  onDownvote,
  onChallenge,
  onReport,
  onComments,
}: ClipActionsProps) {
  const upPressed = vote.myVote === 1;
  const downPressed = vote.myVote === -1;

  return (
    <div className="flex flex-col gap-2 px-4 pt-3 pb-4">
      <div className="flex items-center gap-2">
        <div role="group" aria-label="Rate this clip" className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onUpvote(clip)}
            disabled={voting || isOwnClip}
            aria-pressed={upPressed}
            aria-label={
              isOwnClip
                ? `Thumbs up · ${vote.upvoteCount} — you can't vote on your own clip`
                : upPressed
                  ? `Remove your thumbs up on @${clip.playerUsername}'s clip · ${vote.upvoteCount}`
                  : `Thumbs up clip by @${clip.playerUsername} · current count ${vote.upvoteCount}`
            }
            className={`${THUMB_BASE} ${
              upPressed
                ? "border-brand-orange/40 bg-brand-orange/15 text-brand-orange"
                : "border-border bg-surface/60 text-white/90 hover:border-brand-orange/30 hover:bg-brand-orange/5"
            }`}
          >
            <ThumbsUpIcon size={14} className={upPressed ? "text-brand-orange" : "text-brand-orange/80"} />
            <span className="font-display text-xs tracking-wider tabular-nums">{vote.upvoteCount}</span>
          </button>
          <button
            type="button"
            onClick={() => onDownvote(clip)}
            disabled={voting || isOwnClip}
            aria-pressed={downPressed}
            aria-label={
              isOwnClip
                ? `Thumbs down · ${vote.downvoteCount} — you can't vote on your own clip`
                : downPressed
                  ? `Remove your thumbs down on @${clip.playerUsername}'s clip · ${vote.downvoteCount}`
                  : `Thumbs down clip by @${clip.playerUsername} · current count ${vote.downvoteCount}`
            }
            className={`${THUMB_BASE} ${
              downPressed
                ? "border-brand-red/40 bg-brand-red/15 text-brand-red"
                : "border-border bg-surface/60 text-white/70 hover:border-white/25 hover:bg-white/[0.04] hover:text-white"
            }`}
          >
            <ThumbsDownIcon size={14} />
            <span className="font-display text-xs tracking-wider tabular-nums">{vote.downvoteCount}</span>
          </button>
        </div>

        {!isOwnClip && (
          <button
            type="button"
            onClick={() => onChallenge(clip.playerUsername)}
            aria-label={`Challenge @${clip.playerUsername}`}
            className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-orange via-[#FF7A1A] to-[#FF8533] font-display text-sm tracking-wider text-white shadow-[0_2px_12px_rgba(255,107,0,0.18)] ring-1 ring-white/[0.08] transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <span>Challenge</span>
            <ChevronRightIcon size={14} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onComments(clip)}
          aria-label={`Comments on @${clip.playerUsername}'s clip`}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-border px-3.5 font-display text-[11px] tracking-[0.15em] text-faint transition-all duration-300 hover:border-border-hover hover:bg-white/[0.02] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          COMMENTS
        </button>
        <button
          type="button"
          onClick={() => onReport(clip)}
          disabled={isOwnClip}
          aria-label={`Report clip by @${clip.playerUsername}`}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-border px-3.5 font-display text-[11px] tracking-[0.15em] text-faint transition-all duration-300 hover:border-border-hover hover:bg-white/[0.02] hover:text-white disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          <FlagIcon size={13} />
          REPORT
        </button>
      </div>
    </div>
  );
});
