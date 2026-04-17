import { useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { TargetIcon, FilmIcon, ClockIcon, XCircleIcon, SkullIcon, type IconProps } from "./icons";

const RULES: { Icon: (props: IconProps) => React.ReactNode; text: string; color: string }[] = [
  { Icon: TargetIcon, text: "You set the first trick", color: "text-brand-orange" },
  { Icon: FilmIcon, text: "One-take video only — no retries", color: "text-brand-orange" },
  { Icon: ClockIcon, text: "24 hours per turn or forfeit", color: "text-brand-orange" },
  { Icon: XCircleIcon, text: "Miss a match = earn a letter", color: "text-brand-red" },
  { Icon: SkullIcon, text: "Spell S.K.A.T.E. = you lose", color: "text-brand-red" },
];

export function RulesSheet({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-end justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-sheet-title"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      data-testid="rules-sheet"
    >
      <div
        ref={panelRef}
        className="glass-card rounded-t-2xl px-6 pt-6 pb-safe max-w-md w-full animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 id="rules-sheet-title" className="font-display text-lg text-white tracking-wider">
            RULES
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close rules"
            autoFocus
            className="font-body text-sm text-muted hover:text-white rounded-lg px-2 py-1 -mr-2"
          >
            Close
          </button>
        </div>
        <div className="font-body text-sm text-muted space-y-3 pb-4">
          {RULES.map(({ Icon, text, color }) => (
            <div key={text} className="flex items-center gap-3">
              <Icon size={16} className={`${color} shrink-0`} /> {text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
