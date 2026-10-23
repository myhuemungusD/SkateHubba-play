import { FIELD_LABEL } from "../ui/Field";
import type { ReactNode } from "react";

/** Toggle-style option button used across the editor panels (44px min target). */
export function Chip({
  selected,
  onClick,
  children,
  hint,
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={hint}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-[44px] shrink-0 rounded-xl border px-3 py-2 font-body text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-40 ${
        selected
          ? "border-brand-orange bg-brand-orange/15 text-white"
          : "border-border bg-surface-alt/60 text-muted hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

export function PanelHeading({ children }: { children: ReactNode }) {
  return <h4 className={`mb-2 ${FIELD_LABEL}`}>{children}</h4>;
}

/** The editor's tool tab strip (Trim, Look, Text, ...). */
export function ToolTabs<T extends string>({
  tabs,
  tab,
  onTab,
}: {
  tabs: readonly T[];
  tab: T;
  onTab: (t: T) => void;
}) {
  return (
    <div data-scroll-x role="tablist" aria-label="Editor tools" className="flex gap-1 overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t}
          role="tab"
          type="button"
          aria-selected={tab === t}
          onClick={() => onTab(t)}
          className={`min-h-[44px] shrink-0 rounded-lg px-3 font-body text-sm ${tab === t ? "bg-white/10 text-white" : "text-faint"}`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
