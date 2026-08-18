import { Eye, EyeOff } from "lucide-react";
import type { ReactElement } from "react";

/**
 * Reveal/mask control for a password input. Render it through `Field`'s
 * `rightSlot` — `Field` owns the positioning, this owns the affordance.
 *
 * `onMouseDown` is prevented so a pointer press never pulls focus off the
 * input mid-typing; the click still fires, and keyboard users reach the
 * button by Tab (Enter/Space dispatch click without a mousedown).
 */
export function PasswordToggle({
  visible,
  onToggle,
  /** Noun used in the accessible name, e.g. "confirm password". */
  label = "password",
}: {
  visible: boolean;
  onToggle: () => void;
  label?: string;
}): ReactElement {
  const Icon = visible ? EyeOff : Eye;
  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseDown={(e) => e.preventDefault()}
      aria-label={`${visible ? "Hide" : "Show"} ${label}`}
      aria-pressed={visible}
      className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-xl bg-transparent border-none text-subtle cursor-pointer hover:text-white transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}
