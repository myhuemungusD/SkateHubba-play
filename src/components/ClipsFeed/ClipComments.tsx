import { useRef } from "react";
import type { ClipComment } from "../../services/clips.comments";
import { useSwipeDownToClose } from "../useSwipeDownToClose";
import type { ClipDoc } from "../../services/clips";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { ClipCommentComposer } from "./ClipCommentComposer";
import { ClipCommentRow } from "./ClipCommentRow";
import { useClipComments } from "./useClipComments";
import { ActionMenu } from "../ui/ActionMenu";

export interface ClipCommentsProps {
  clip: ClipDoc;
  viewerUid: string;
  viewerUsername: string;
  onClose: () => void;
  /** Opens the report flow for the clip this thread belongs to. Omitted
   *  entirely hides the control. */
  onReport?: () => void;
  /** Opens the report flow for one comment (App Review 1.2: every piece of
   *  user text is reportable). Omitted hides the per-comment control. */
  onReportComment?: (comment: ClipComment) => void;
  /** Opens a comment author's profile (where Block lives). */
  onViewPlayer?: (uid: string) => void;
  /** Uids the viewer has blocked. Their comments are filtered out of the
   *  thread, matching how the feed drops their clips. */
  blockedUids?: ReadonlySet<string>;
}

/**
 * Comment thread for one clip, as an iOS-style bottom sheet over the feed:
 * full width on phones with a grabber, swipe down or Done to dismiss, clip
 * Report in the ••• menu, and the composer clear of the home indicator.
 *
 * A sheet rather than an expanding section: the thread can run long, and
 * growing the spotlight card would push the video — the thing being discussed
 * — off screen. Focus is trapped while it is open (`useFocusTrap`), and it
 * closes on backdrop tap or Escape, matching ReportModal.
 */
export function ClipComments({
  clip,
  viewerUid,
  viewerUsername,
  onClose,
  onReport,
  onReportComment,
  onViewPlayer,
  blockedUids,
}: ClipCommentsProps) {
  const c = useClipComments(clip.id, viewerUid, viewerUsername, blockedUids);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  useSwipeDownToClose(panelRef, onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clip-comments-title"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        ref={panelRef}
        className="glass-card flex max-h-[85vh] w-full animate-scale-in flex-col rounded-t-3xl px-5 pt-2 pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:max-w-sm sm:rounded-2xl sm:pt-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div aria-hidden="true" className="mx-auto mb-2 h-[5px] w-9 shrink-0 rounded-full bg-white/25 sm:hidden" />
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 id="clip-comments-title" className="font-display text-lg text-white">
            Comments
          </h3>
          <div className="-mr-2 flex items-center">
            {onReport && (
              <ActionMenu
                label="More options for this clip"
                items={[{ label: "Report clip", destructive: true, onSelect: onReport }]}
              />
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl px-2 font-body text-base font-semibold text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            >
              Done
            </button>
          </div>
        </div>

        <p className="mb-3 font-body text-xs text-faint">
          on <span className="text-white/80">{clip.trickName}</span> by @{clip.playerUsername}
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {c.loading && (
            <p role="status" aria-label="Loading comments" className="font-body text-xs text-subtle">
              Loading comments...
            </p>
          )}

          {!c.loading && c.error && (
            <p role="alert" className="font-body text-xs text-brand-red">
              {c.error}
            </p>
          )}

          {!c.loading && !c.error && c.comments.length === 0 && (
            <p
              data-testid="comments-empty"
              className="rounded-2xl border border-dashed border-border px-4 py-6 text-center font-body text-xs text-subtle"
            >
              No comments yet. Be first.
            </p>
          )}

          {c.comments.length > 0 && (
            <ul className="flex flex-col gap-2">
              {c.comments.map((comment) => (
                <ClipCommentRow
                  key={comment.id}
                  comment={comment}
                  canDelete={comment.userId === viewerUid}
                  deleting={c.deletingId === comment.id}
                  onDelete={(target) => void c.remove(target)}
                  onReport={onReportComment}
                  onViewAuthor={onViewPlayer}
                />
              ))}
            </ul>
          )}
        </div>

        <ClipCommentComposer
          draft={c.draft}
          onDraftChange={c.setDraft}
          onSubmit={() => void c.submit()}
          posting={c.posting}
          canSubmit={c.canSubmit}
        />
      </div>
    </div>
  );
}
