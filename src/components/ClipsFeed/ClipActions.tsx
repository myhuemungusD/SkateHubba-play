import { memo } from "react";
import type { ClipDoc, ClipUpvoteState } from "../../services/clips";
import { ChevronRightIcon, FlagIcon, ThumbsDownIcon, ThumbsUpIcon } from "../icons";

export interface ClipActionsProps {
  clip: ClipDoc;
  isOwnClip: boolean;
  upvote: ClipUpvoteState;
  /** True while this clip's vote write is in flight — locks both thumbs. */
  voting: boolean;
  onUpvote: (clip: ClipDoc) => void;
  onDownvote: (clip: ClipDoc) => void;
  onChallenge: (username: string) => void;
  onReport: (clip: ClipDoc) => void;
}

/**
 * Action row under a community clip: thumbs up / thumbs down, challenge,
 * report.
 *
 * Thumbs down is the inverse of thumbs up, not a separate negative tally:
 * on a clip you upvoted it withdraws the vote (`removeUpvote`); on one you
 * haven't it simply passes — the clip is skipped for the rest of the
 * session. There is no downvoteCount in the data model, so a "dislike"
 * counter would be a schema + rules change; passing keeps the control
 * honest about what it actually does.
 */
export const ClipActions = memo(function ClipActions({
  clip,
  isOwnClip,
  upvote,
  voting,
  onUpvote,
  onDownvote,
  onChallenge,
  onReport,
}: ClipActionsProps) {
  return (
    <div className="px-4 pt-3 pb-4 flex items-center gap-2">
      {!isOwnClip && (
        <div role="group" aria-label="Rate this clip" className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onUpvote(clip)}
            disabled={voting || upvote.alreadyUpvoted}
            aria-pressed={upvote.alreadyUpvoted}
            aria-label={
              upvote.alreadyUpvoted
                ? `Thumbs up given · ${upvote.count}`
                : `Thumbs up clip by @${clip.playerUsername} · current count ${upvote.count}`
            }
            className={`min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 border transition-all duration-300 ease-smooth focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed active:scale-[0.97] ${
              upvote.alreadyUpvoted
                ? "border-brand-orange/40 bg-brand-orange/15 text-brand-orange"
                : "border-border bg-surface/60 text-white/90 hover:border-brand-orange/30 hover:bg-brand-orange/5"
            }`}
          >
            <ThumbsUpIcon size={14} className={upvote.alreadyUpvoted ? "text-brand-orange" : "text-brand-orange/80"} />
            <span className="font-display text-xs tracking-wider tabular-nums">{upvote.count}</span>
          </button>
          <button
            type="button"
            onClick={() => onDownvote(clip)}
            disabled={voting}
            aria-label={
              upvote.alreadyUpvoted
                ? `Take back your thumbs up on @${clip.playerUsername}'s clip`
                : `Thumbs down — skip @${clip.playerUsername}'s clip`
            }
            className="min-h-[44px] inline-flex items-center justify-center rounded-xl px-3.5 border border-border bg-surface/60 text-white/70 hover:border-white/25 hover:bg-white/[0.04] hover:text-white transition-all duration-300 ease-smooth focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed active:scale-[0.97]"
          >
            <ThumbsDownIcon size={14} />
          </button>
        </div>
      )}
      {!isOwnClip && (
        <button
          type="button"
          onClick={() => onChallenge(clip.playerUsername)}
          aria-label={`Challenge @${clip.playerUsername}`}
          className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl font-display text-sm tracking-wider bg-gradient-to-r from-brand-orange via-[#FF7A1A] to-[#FF8533] text-white active:scale-[0.97] hover:-translate-y-0.5 transition-all duration-300 shadow-[0_2px_12px_rgba(255,107,0,0.18)] ring-1 ring-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          <span>Challenge</span>
          <ChevronRightIcon size={14} />
        </button>
      )}
      <button
        type="button"
        onClick={() => onReport(clip)}
        disabled={isOwnClip}
        aria-label={`Report clip by @${clip.playerUsername}`}
        className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 font-display text-[11px] tracking-[0.15em] text-faint border border-border hover:text-white hover:border-border-hover hover:bg-white/[0.02] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      >
        <FlagIcon size={13} />
        REPORT
      </button>
    </div>
  );
});
