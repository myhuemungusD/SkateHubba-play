import { TURN_LENGTH_OPTIONS, type TurnLengthHours } from "../services/turnDuration";

interface Props {
  value: TurnLengthHours;
  onChange: (hours: TurnLengthHours) => void;
  disabled?: boolean;
}

const LABELS: Record<TurnLengthHours, string> = { 24: "24 hours", 72: "3 days", 168: "7 days" };

/**
 * Chip row for how long each turn lasts (VITE_FEATURE_TURN_LENGTH). Rendered
 * on the ChallengeScreen; the choice is stored immutably on the game doc.
 * Same radiogroup pattern as TrickCategoryPicker.
 */
export function TurnLengthPicker({ value, onChange, disabled = false }: Props) {
  return (
    <div className="mb-4">
      <span className="font-display text-sm tracking-[0.2em] text-muted block mb-2">TIME PER TURN</span>
      <div role="radiogroup" aria-label="Time per turn" className="flex flex-wrap gap-2">
        {TURN_LENGTH_OPTIONS.map((hours) => {
          const selected = hours === value;
          return (
            <button
              key={hours}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(hours)}
              className={`touch-target inline-flex items-center rounded-full border px-3 py-1.5 font-body text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange ${
                selected
                  ? "border-brand-orange/40 bg-brand-orange/10 text-brand-orange"
                  : "border-white/[0.08] text-muted hover:text-white hover:border-white/[0.15]"
              }`}
            >
              {LABELS[hours]}
            </button>
          );
        })}
      </div>
      <p className="font-body text-xs text-subtle mt-2">
        Miss your turn and you forfeit. Longer turns suit skaters who can&apos;t get out every day.
      </p>
    </div>
  );
}
