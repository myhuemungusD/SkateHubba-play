interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name. Use the visible label's text so voice control matches it. */
  label: string;
  disabled?: boolean;
}

/**
 * The app's on/off toggle (Settings, Spot passport). The outer button is the
 * 44pt tap target (iOS HIG / Material minimum); the compact pill lives in an
 * inner span so the design stays tight while the hit area extends past it.
 * Switch semantics (role, aria-checked, name) stay on the button.
 */
export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-all duration-300 ${
          checked
            ? "bg-brand-orange/25 border-brand-orange/60 shadow-[0_0_8px_rgba(255,107,0,0.2)]"
            : "bg-surface-alt border-border"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-300 ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </span>
    </button>
  );
}
