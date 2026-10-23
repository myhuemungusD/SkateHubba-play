import type { ReactNode } from "react";

interface Props {
  title: string;
  /** One line on what the feature will do. */
  description: string;
  icon?: ReactNode;
  /** Tag text; defaults to COMING SOON. */
  status?: string;
}

/**
 * Polished stand-in for a pro/admin feature that is designed but not built.
 * Not interactive: it renders as a labelled region rather than a dead button.
 */
export function ComingSoonCard({ title, description, icon, status }: Props) {
  return (
    <section
      aria-label={`${title} (${status ? status.toLowerCase() : "coming soon"})`}
      className="flex items-start gap-3 rounded-2xl border border-dashed border-white/[0.12] bg-surface/40 p-4"
    >
      {icon && (
        <span className="mt-0.5 shrink-0 text-brand-orange" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-display text-xs tracking-[0.15em] text-white">{title.toUpperCase()}</h4>
          <span className="rounded-full border border-brand-orange/40 bg-brand-orange/10 px-2 py-0.5 font-display text-[11px] tracking-[0.15em] text-brand-orange">
            {status ?? "COMING SOON"}
          </span>
        </div>
        <p className="mt-1 font-body text-xs leading-relaxed text-white/70">{description}</p>
      </div>
    </section>
  );
}
