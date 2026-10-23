export function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h3 className="font-display text-sm tracking-[0.2em] text-brand-orange">{title}</h3>
      <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-sm text-brand-orange leading-none tabular-nums">
        {count}
      </span>
    </div>
  );
}
