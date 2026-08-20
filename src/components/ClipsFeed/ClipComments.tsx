import { useRef } from "react";
import type { ClipDoc } from "../../services/clips";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { ClipCommentComposer } from "./ClipCommentComposer";
import { ClipCommentRow } from "./ClipCommentRow";
import { useClipComments } from "./useClipComments";

export interface ClipCommentsProps {
  clip: ClipDoc;
  viewerUid: string;
  viewerUsername: string;
  onClose: () => void;
}

/**
 * Comment thread for one clip, as a bottom sheet over the feed.
 *
 * A sheet rather than an expanding section: the thread can run long, and
 * growing the spotlight card would push the video — the thing being discussed
 * — off screen. Focus is trapped while it is open (`useFocusTrap`), and it
 * closes on backdrop tap or Escape, matching ReportModal.
 */
export function ClipComments({ clip, viewerUid, viewerUsername, onClose }: ClipCommentsProps) {
  const c = useClipComments(clip.id, viewerUid, viewerUsername);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center sm:p-6"
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
        className="glass-card flex max-h-[85vh] w-full max-w-sm animate-scale-in flex-col rounded-t-2xl p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 id="clip-comments-title" className="font-display text-lg text-white">
            Comments
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comments"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-border font-display text-[11px] tracking-[0.15em] text-muted transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            CLOSE
          </button>
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
