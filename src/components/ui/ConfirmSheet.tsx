import { useId, useRef } from "react";
import { useSheetFocusTrap } from "../useSheetFocusTrap";

interface ConfirmSheetProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** While the confirm action is in flight: disables confirm and sets aria-busy so a double-tap can't fire it twice. */
  busy?: boolean;
}

/**
 * A two-button bottom sheet for anything that can't be undone (forfeit,
 * decline, sign out). The safe choice is the primary white button.
 */
export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  cancelLabel = "Keep playing",
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  useSheetFocusTrap(panelRef, onCancel);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      onClick={onCancel}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl border-t border-white/10 bg-surface px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-6"
      >
        <h2 id={`${id}-title`} className="font-display text-2xl tracking-wider text-white">
          {title}
        </h2>
        <p id={`${id}-body`} className="mt-2 font-body text-sm text-bright">
          {body}
        </p>
        <div className="mt-5 space-y-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-12 w-full rounded-2xl bg-white font-display text-lg tracking-wider text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
            className="min-h-12 w-full rounded-2xl border border-brand-red/50 font-display text-lg tracking-wider text-brand-red disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
