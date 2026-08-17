export type AdminTab = "verify" | "awards" | "reports";

const TABS: ReadonlyArray<{ id: AdminTab; label: string }> = [
  { id: "verify", label: "Verify Pro" },
  { id: "awards", label: "Awards" },
  { id: "reports", label: "Reports" },
];

/**
 * Segmented control for the three admin surfaces. Same `aria-pressed` toggle
 * treatment as the clips feed's Top/New control so the selected affordance
 * reads identically across the app.
 */
export function AdminTabs({ tab, onChange }: { tab: AdminTab; onChange: (next: AdminTab) => void }) {
  return (
    <div
      role="group"
      aria-label="Admin sections"
      className="mb-6 grid grid-cols-3 gap-1 rounded-xl border border-border bg-surface/40 p-0.5"
    >
      {TABS.map(({ id, label }) => {
        const pressed = tab === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-pressed={pressed}
            className={`min-h-[44px] inline-flex items-center justify-center rounded-lg px-2 font-display text-[11px] tracking-[0.2em] transition-all duration-300 ease-smooth focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange active:scale-[0.97] ${
              pressed
                ? "border border-brand-orange/40 bg-brand-orange/15 text-brand-orange"
                : "border border-transparent text-white/80 hover:border-brand-orange/30 hover:bg-brand-orange/5 hover:text-white"
            }`}
          >
            {label.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
