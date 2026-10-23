import { memo } from "react";
import type { ClipComment } from "../../services/clips.comments";
import { ProUsername } from "../ProUsername";
import { relativeClipTime } from "./utils";

export interface ClipCommentRowProps {
  comment: ClipComment;
  /** Shows the delete control. Only ever true for the author's own comment. */
  canDelete: boolean;
  deleting: boolean;
  onDelete: (comment: ClipComment) => void;
  /** Report this comment. Offered on everyone's comments but your own. */
  onReport?: (comment: ClipComment) => void;
  /** Opens the author's profile, which is where Block lives. */
  onViewAuthor?: (uid: string) => void;
}

/**
 * One comment. Split into its own file so the sheet stays inside the 250 LOC
 * budget and the "author can delete, nobody else can" rule has one home.
 */
export const ClipCommentRow = memo(function ClipCommentRow({
  comment,
  canDelete,
  deleting,
  onDelete,
  onReport,
  onViewAuthor,
}: ClipCommentRowProps) {
  return (
    <li
      data-testid={`comment-${comment.id}`}
      className="rounded-xl border border-border bg-surface/60 px-3 pt-1 pb-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        {onViewAuthor ? (
          // One 44pt target for avatar + handle (audit #1): the handle leads
          // to the profile, where Block lives, so it must not be a mis-tap.
          <button
            type="button"
            onClick={() => onViewAuthor(comment.userId)}
            aria-label={`View @${comment.username}'s profile`}
            className="-ml-1 inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg pl-1 pr-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <Author username={comment.username} />
          </button>
        ) : (
          <span className="inline-flex min-h-11 min-w-0 items-center gap-2">
            <Author username={comment.username} />
          </span>
        )}
        <span className="shrink-0 font-body text-label text-faint">{relativeClipTime(comment.createdAt)}</span>
      </div>
      {/* Untrusted user text. Rendered as a plain text node so React escapes
          it, `whitespace-pre-wrap` to keep the author's line breaks, and
          `break-words` so an unbroken 300-char string can't widen the sheet. */}
      <p className="font-body text-sm leading-relaxed break-words whitespace-pre-wrap text-white/90">{comment.text}</p>
      {!canDelete && onReport && (
        <button
          type="button"
          onClick={() => onReport(comment)}
          aria-label={`Report comment by @${comment.username}`}
          className="-mb-2 mt-0.5 inline-flex min-h-11 items-center font-body text-xs font-semibold text-subtle transition-colors hover:text-brand-red focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          Report
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={() => onDelete(comment)}
          disabled={deleting}
          aria-label="Delete your comment"
          className="-mb-2 mt-0.5 inline-flex min-h-11 items-center font-body text-xs font-semibold text-subtle transition-colors hover:text-brand-red disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      )}
    </li>
  );
});

/** 28px initial avatar and handle. Comments carry no photo URL (denormalised username only). */
function Author({ username }: { username: string }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-alt font-display text-sm text-white/80"
      >
        {username[0]?.toUpperCase() ?? "?"}
      </span>
      <ProUsername username={username} className="truncate font-body text-sm font-semibold text-white/90" />
    </>
  );
}
