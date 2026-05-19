import { memo } from "react";
import type { ClipsFeedSort } from "../../services/clips";

export interface TopNewToggleProps {
  sort: ClipsFeedSort;
  onChange: (sort: ClipsFeedSort) => void;
  /** Locks both buttons (e.g. while a fetch is in flight). */
  disabled?: boolean;
}

/**
 * Segmented control that flips the clips feed between vote-driven ranking
 * ("Top") and reverse-chronological ("New"). Selected state uses the same
 * brand-orange treatment as the upvote button in ClipActions, so the active
 * affordance is consistent across the spotlight.
 */
export const TopNewToggle = memo(function TopNewToggle({ sort, onChange, disabled }: TopNewToggleProps) {
  return (
    <div
      role="group"
      aria-label="Sort clips"
      className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface/40 p-0.5"
    >
      <ToggleButton label="Top" pressed={sort === "top"} disabled={disabled} onClick={() => onChange("top")} />
      <ToggleButton label="New" pressed={sort === "new"} disabled={disabled} onClick={() => onChange("new")} />
    </div>
  );
});

function ToggleButton({
  label,
  pressed,
  disabled,
  onClick,
}: {
  label: string;
  pressed: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={`min-h-[44px] inline-flex items-center justify-center rounded-lg px-3.5 font-display text-[11px] tracking-[0.2em] transition-all duration-300 ease-smooth focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 ${
        pressed
          ? "border border-brand-orange/40 bg-brand-orange/15 text-brand-orange"
          : "border border-transparent text-white/80 hover:border-brand-orange/30 hover:bg-brand-orange/5 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}
