import { useRef } from "react";
import { useSheetFocusTrap } from "../useSheetFocusTrap";

interface ConfirmSheetProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A two-button bottom sheet for anything that can't be undone (forfeit, decline). */
export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  cancelLabel = "Keep playing",
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useSheetFocusTrap(panelRef, onCancel);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="dice-confirm-title"
      aria-describedby="dice-confirm-body"
      onClick={onCancel}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl border-t border-white/10 bg-[#121212] px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-6"
      >
        <h2 id="dice-confirm-title" className="font-display text-2xl tracking-wider text-white">
          {title}
        </h2>
        <p id="dice-confirm-body" className="mt-2 font-body text-sm text-bright">
          {body}
        </p>
        <div className="mt-5 space-y-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-12 w-full rounded-2xl bg-white font-display text-lg tracking-wider text-[#111]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-12 w-full rounded-2xl border border-brand-red/50 font-display text-lg tracking-wider text-brand-red"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
