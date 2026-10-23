/* ── Preference row primitive ───────────────────────────── */

export interface PrefRowProps {
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  trailing?: React.ReactNode;
}

export function PrefRow({ title, description, checked, onChange, disabled, trailing }: PrefRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-2xl glass-card">
      <div className="min-w-0">
        <p className="font-display text-sm text-white tracking-wide">{title}</p>
        <p className="font-body text-xs text-faint mt-1 leading-snug">{description}</p>
        {trailing && <div className="mt-2">{trailing}</div>}
      </div>
      {/* Outer button is the 44pt tap target (iOS HIG / Material Design
          minimum); the visually compact pill lives in an inner span so the
          design stays tight while the accessible hit area extends past it.
          Switch semantics (role, aria-checked, label) stay on the button so
          assistive tech still identifies this as a toggle. */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
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
    </div>
  );
}

/* ── Section header ─────────────────────────────────────── */

export function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-3 mt-8 first:mt-0">
      <h2 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">{title}</h2>
      {typeof count === "number" && (
        <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[11px] text-brand-orange leading-none tabular-nums">
          {count}
        </span>
      )}
    </div>
  );
}
