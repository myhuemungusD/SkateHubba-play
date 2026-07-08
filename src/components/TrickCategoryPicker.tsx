import { TRICK_CATEGORIES, type TrickCategoryId } from "../constants/trickCategories";

interface Props {
  value: TrickCategoryId;
  onChange: (id: TrickCategoryId) => void;
  disabled?: boolean;
}

/**
 * Horizontal chip row for choosing a game's trick category. Rendered on the
 * ChallengeScreen; the selection is stored immutably on the game doc. Mirrors
 * the `role="radiogroup"` + `role="radio"` chip pattern used by ProfileSetup's
 * Stance picker — each chip is a real `<button>`, so tab lands on each chip
 * and Enter/Space selects it. `aria-checked` reflects the current selection.
 */
export function TrickCategoryPicker({ value, onChange, disabled = false }: Props) {
  return (
    <div className="mb-4">
      <span className="font-display text-[11px] tracking-[0.2em] text-muted block mb-2">TRICK CATEGORY</span>
      <div role="radiogroup" aria-label="Trick category" className="flex flex-wrap gap-2">
        {TRICK_CATEGORIES.map((cat) => {
          const selected = cat.id === value;
          return (
            <button
              key={cat.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(cat.id)}
              className={`touch-target inline-flex items-center rounded-full border px-3 py-1.5 font-body text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange ${
                selected
                  ? "border-brand-orange/40 bg-brand-orange/10 text-brand-orange"
                  : "border-white/[0.08] text-muted hover:text-white hover:border-white/[0.15]"
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
