import { useState } from "react";

type Tone = "brand" | "danger";

const TONES: Record<Tone, string> = {
  brand:
    "border-brand-orange/40 bg-brand-orange/[0.12] text-brand-orange hover:bg-brand-orange/20 disabled:hover:bg-brand-orange/[0.12]",
  danger:
    "border-brand-red/30 bg-brand-red/[0.08] text-brand-red hover:bg-brand-red/20 disabled:hover:bg-brand-red/[0.08]",
};

interface Props {
  /** Resting label, e.g. "Grant". */
  label: string;
  /** Question shown in the confirm row, e.g. "Grant Verified Pro to @nyjah?". */
  question: string;
  /** Label of the confirming button, e.g. "Grant". */
  confirmLabel: string;
  onConfirm: () => void;
  /** Shows "..." on the trigger and blocks re-entry while the action runs. */
  loading?: boolean;
  disabled?: boolean;
  tone?: Tone;
}

/**
 * Two-step action button. Reuses the block-confirm pattern from the player
 * profile: the confirm step is an inline row rather than a modal, so it needs
 * no focus trap and can't be dismissed by a stray backdrop tap mid-decision.
 *
 * Confirming closes the row immediately — the trigger then carries the
 * in-flight state from the parent, so an operator never sees two competing
 * spinners for one action.
 */
export function ConfirmButton({ label, question, confirmLabel, onConfirm, loading, disabled, tone = "brand" }: Props) {
  const [open, setOpen] = useState(false);

  if (open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-alt/60 p-2">
        <span className="font-body text-xs text-subtle">{question}</span>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border px-3 font-body text-xs text-muted transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
            className={`inline-flex min-h-[44px] items-center justify-center rounded-lg border px-3 font-display text-[11px] tracking-[0.15em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange ${TONES[tone]}`}
          >
            {confirmLabel.toUpperCase()}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      disabled={disabled || loading}
      className={`inline-flex min-h-[44px] items-center justify-center rounded-xl border px-4 font-display text-[11px] tracking-[0.15em] transition-colors active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-40 ${TONES[tone]}`}
    >
      {loading ? "..." : label.toUpperCase()}
    </button>
  );
}
