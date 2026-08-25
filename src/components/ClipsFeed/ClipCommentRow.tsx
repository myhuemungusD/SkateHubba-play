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
}: ClipCommentRowProps) {
  return (
    <li data-testid={`comment-${comment.id}`} className="rounded-xl border border-border bg-surface/60 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <ProUsername username={comment.username} className="font-body text-xs text-white/80" />
        <span className="shrink-0 font-body text-[11px] text-faint">{relativeClipTime(comment.createdAt)}</span>
      </div>
      {/* Untrusted user text. Rendered as a plain text node so React escapes
          it, `whitespace-pre-wrap` to keep the author's line breaks, and
          `break-words` so an unbroken 300-char string can't widen the sheet. */}
      <p className="mt-1 font-body text-sm leading-relaxed break-words whitespace-pre-wrap text-white/90">
        {comment.text}
      </p>
      {canDelete && (
        <button
          type="button"
          onClick={() => onDelete(comment)}
          disabled={deleting}
          aria-label="Delete your comment"
          className="mt-1.5 inline-flex min-h-[44px] items-center font-display text-[11px] tracking-[0.15em] text-faint transition-colors hover:text-brand-red disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          {deleting ? "DELETING..." : "DELETE"}
        </button>
      )}
    </li>
  );
});
