import { memo } from "react";
import type { ClipDoc } from "../../services/clips";
import type { ClipVoteState } from "../../services/clips.upvotes";
import { FlagIcon, SkateboardIcon, ThumbsDownIcon, ThumbsUpIcon } from "../icons";
import { ABOVE_NAV, RAIL_BTN } from "./feedLayout";

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

/**
 * Side rail on a community clip, Shorts-style. Thumbs, comments, challenge,
 * and report sit on the video instead of under it, so a vote never has to
 * finish before the viewer can swipe.
 *
 * Both thumbs are one persisted vote: tapping the thumb you already gave
 * withdraws it (`aria-pressed`), tapping the other flips it. Neither hides
 * the clip. On your own clip the thumbs stay visible and disabled.
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
    <div className={`absolute right-3 z-20 flex flex-col items-center gap-3 ${ABOVE_NAV}`}>
      <div role="group" aria-label="Rate this clip" className="flex flex-col items-center gap-3">
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
          className={`${RAIL_BTN} ${upPressed ? "border-brand-orange/60 bg-brand-orange/30 text-brand-orange" : ""}`}
        >
          <ThumbsUpIcon size={18} className={upPressed ? "text-brand-orange" : "text-white"} />
          <span className="font-display text-[10px] leading-none tabular-nums">{vote.upvoteCount}</span>
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
          className={`${RAIL_BTN} ${downPressed ? "border-brand-red/60 bg-brand-red/30 text-brand-red" : ""}`}
        >
          <ThumbsDownIcon size={18} />
          <span className="font-display text-[10px] leading-none tabular-nums">{vote.downvoteCount}</span>
        </button>
      </div>

      <button
        type="button"
        onClick={() => onComments(clip)}
        aria-label={`Comments on @${clip.playerUsername}'s clip`}
        className={RAIL_BTN}
      >
        <CommentGlyph />
      </button>

      {!isOwnClip && (
        <button
          type="button"
          onClick={() => onChallenge(clip.playerUsername)}
          aria-label={`Challenge @${clip.playerUsername}`}
          className={RAIL_BTN}
        >
          <SkateboardIcon size={18} />
        </button>
      )}

      <button
        type="button"
        onClick={() => onReport(clip)}
        disabled={isOwnClip}
        aria-label={`Report clip by @${clip.playerUsername}`}
        className={RAIL_BTN}
      >
        <FlagIcon size={16} />
      </button>
    </div>
  );
});

function CommentGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 1 1 18 0z" strokeLinejoin="round" />
    </svg>
  );
}
