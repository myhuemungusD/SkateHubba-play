import { lazy, Suspense, useState } from "react";
import { OTHER_TRICK_ID, formatTrickDisplayName, type TrickSelection } from "../constants/tricks";
import { CUSTOM_CATEGORY_ID, trickCategoryHeadline, type TrickCategoryId } from "../constants/trickCategories";

const TrickPicker = lazy(() => import("./TrickPicker").then((m) => ({ default: m.TrickPicker })));

interface Props {
  selection: TrickSelection | null;
  onChange: (selection: TrickSelection | null) => void;
  disabled: boolean;
  trickCategory?: TrickCategoryId;
  customRules?: string | null;
}

/**
 * The setter's trick picker as a one-row card, so the live camera preview
 * under it stays the main thing on screen. Opens on tap and folds itself
 * away once a trick is picked from the list.
 */
export function CollapsibleTrickPicker({ selection, onChange, disabled, trickCategory, customRules }: Props) {
  const [open, setOpen] = useState(false);
  const name = selection ? formatTrickDisplayName(selection) : "";
  const headline = trickCategoryHeadline(trickCategory, customRules);
  const constraintText = headline && (trickCategory === CUSTOM_CATEGORY_ID ? headline : `${headline} only`);

  if (open && !disabled) {
    return (
      <div className="mb-3">
        <Suspense fallback={<div className="h-14" />}>
          <TrickPicker
            selection={selection}
            onChange={(next) => {
              onChange(next);
              // A list pick is final; "Other" still needs its name typed.
              if (next && next.trickId !== OTHER_TRICK_ID && next.trickId !== selection?.trickId) setOpen(false);
            }}
            disabled={disabled}
            trickCategory={trickCategory}
            customRules={customRules}
          />
        </Suspense>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="-mt-3 min-h-11 w-full rounded-xl font-display text-sm tracking-[0.16em] text-brand-orange focus-visible:outline-2 focus-visible:outline-brand-orange"
        >
          DONE
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="trick-picker-summary"
      className="mb-3 flex items-center gap-3 rounded-2xl border border-brand-orange/30 bg-black/50 px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm tracking-[0.2em] text-brand-orange">TRICK</p>
        <p className="truncate font-body text-sm text-white">{name ? `Set your ${name}` : "No trick picked yet"}</p>
        {!name && constraintText && <p className="truncate font-body text-xs text-brand-orange/80">{constraintText}</p>}
      </div>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className="min-h-11 shrink-0 rounded-full border border-brand-orange px-4 font-display text-sm tracking-wider text-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-brand-orange"
      >
        {name ? "Change" : "Pick a trick"}
      </button>
    </div>
  );
}
