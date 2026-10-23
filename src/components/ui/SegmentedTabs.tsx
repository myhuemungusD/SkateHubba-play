import { useRef, type KeyboardEvent } from "react";

export interface SegmentedTab<T extends string> {
  id: T;
  label: string;
}

interface Props<T extends string> {
  tabs: readonly SegmentedTab<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Accessible name for the tab list. */
  label: string;
  /** Prefix for tab/panel ids; the panel should use `${idPrefix}-panel`. */
  idPrefix: string;
}

/**
 * iOS-style segmented control with tab semantics: one tab stop, arrow keys
 * move between segments, and each 44px segment owns the panel below it.
 */
export function SegmentedTabs<T extends string>({ tabs, value, onChange, label, idPrefix }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : -1;
    const next = (tabs.findIndex((t) => t.id === value) + step + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-border bg-surface p-1"
    >
      {tabs.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={`min-h-11 rounded-lg font-body text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange ${
              selected ? "bg-surface-alt text-white shadow-card" : "text-muted hover:text-white"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
