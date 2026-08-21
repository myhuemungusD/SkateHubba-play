import { useId } from "react";
import { COMMENT_MAX_LENGTH } from "./useClipComments";

export interface ClipCommentComposerProps {
  draft: string;
  onDraftChange: (text: string) => void;
  onSubmit: () => void;
  posting: boolean;
  canSubmit: boolean;
}

/**
 * Write box under the thread.
 *
 * The counter is always visible rather than appearing near the limit: at 300
 * characters the cap is generous enough that a hidden counter reads as a
 * surprise when it finally shows up. `maxLength` stops typing at the cap so
 * the count only ever climbs to it, never past.
 */
export function ClipCommentComposer({ draft, onDraftChange, onSubmit, posting, canSubmit }: ClipCommentComposerProps) {
  const fieldId = useId();
  const used = draft.trim().length;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <label htmlFor={fieldId} className="sr-only">
        Add a comment
      </label>
      <textarea
        id={fieldId}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        placeholder="Say something about this clip..."
        maxLength={COMMENT_MAX_LENGTH}
        rows={2}
        disabled={posting}
        className="w-full resize-none rounded-2xl border border-border bg-surface-alt/80 px-4 py-3 font-body text-base text-white backdrop-blur-sm transition-all duration-300 outline-none placeholder:text-subtle/60 focus:border-brand-orange focus:shadow-[0_0_0_3px_rgba(255,107,0,0.1)] disabled:cursor-not-allowed disabled:opacity-40"
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="font-body text-xs text-faint tabular-nums" data-testid="comment-count-indicator">
          {used}/{COMMENT_MAX_LENGTH}
        </span>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-gradient-to-r from-brand-orange via-[#FF7A1A] to-[#FF8533] px-5 font-display text-sm tracking-wider text-white ring-1 ring-white/[0.08] transition-all duration-300 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          {posting ? "Posting..." : "Post"}
        </button>
      </div>
    </div>
  );
}
