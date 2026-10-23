import type { ReactNode } from "react";
import { ChevronRightIcon } from "../../components/icons";
import { Switch } from "../../components/ui/Switch";

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
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

/* ── Section header ─────────────────────────────────────── */

/** iOS grouped-list header: 13px sentence case above an inset group. */
export function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-4 mb-2 mt-8 first:mt-0">
      <h2 className="font-body text-caption font-semibold text-muted">{title}</h2>
      {typeof count === "number" && (
        <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-body text-label text-bright leading-none tabular-nums">
          {count}
        </span>
      )}
    </div>
  );
}

/* ── Grouped list ───────────────────────────────────────── */

/** One inset rounded group; rows inside lose their own card (see `.settings-group`). */
export function SettingsGroup({ children }: { children: ReactNode }) {
  return <div className="settings-group">{children}</div>;
}

/** Full-width row class for links and buttons that open something. */
export const ROW_CLASS =
  "flex w-full items-center gap-3 text-left p-4 rounded-2xl glass-card hover:bg-white/[0.03] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-orange disabled:opacity-60 disabled:cursor-not-allowed";

/** Title + optional description + trailing chevron, for {@link ROW_CLASS} rows. */
export function RowBody({ title, sub, tone = "text-white" }: { title: string; sub?: ReactNode; tone?: string }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className={`block font-display text-sm tracking-wide ${tone}`}>{title}</span>
        {sub && <span className="block font-body text-xs text-faint mt-1">{sub}</span>}
      </span>
      <ChevronRightIcon size={16} className="shrink-0 text-subtle" />
    </>
  );
}
