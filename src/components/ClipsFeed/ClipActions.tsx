import { memo } from "react";
import type { ClipDoc, ClipUpvoteState } from "../../services/clips";
import { ChevronRightIcon, FlagIcon, FlameIcon } from "../icons";

export interface ClipActionsProps {
  clip: ClipDoc;
  isOwnClip: boolean;
  upvote: ClipUpvoteState;
  upvoteDisabled: boolean;
  onUpvote: (clip: ClipDoc) => void;
  onChallenge: (username: string) => void;
  onReport: (clip: ClipDoc) => void;
}

export const ClipActions = memo(function ClipActions({
  clip,
  isOwnClip,
  upvote,
  upvoteDisabled,
  onUpvote,
  onChallenge,
  onReport,
}: ClipActionsProps) {
  return (
    <div className="px-4 pt-3 pb-4 flex items-center gap-2">
      {!isOwnClip && (
        <button
          type="button"
          onClick={() => onUpvote(clip)}
          disabled={upvoteDisabled}
          aria-pressed={upvote.alreadyUpvoted}
          aria-label={
            upvote.alreadyUpvoted
              ? `Upvoted · ${upvote.count}`
              : `Upvote clip by @${clip.playerUsername} · current count ${upvote.count}`
          }
          className={`min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 border transition-all duration-300 ease-smooth focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed active:scale-[0.97] ${
            upvote.alreadyUpvoted
              ? "border-brand-orange/40 bg-brand-orange/15 text-brand-orange"
              : "border-border bg-surface/60 text-white/90 hover:border-brand-orange/30 hover:bg-brand-orange/5"
          }`}
        >
          <FlameIcon size={14} className={upvote.alreadyUpvoted ? "text-brand-orange" : "text-brand-orange/80"} />
          <span className="font-display text-xs tracking-wider tabular-nums">{upvote.count}</span>
        </button>
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
