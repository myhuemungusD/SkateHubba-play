import type { ProField } from "../../constants/proProfiles";

/**
 * Renders a pro profile field. Placeholder copy gets a dashed outline and a
 * "PLACEHOLDER" tag so nobody mistakes review text for a confirmed fact.
 */
export function ProFieldText({ field, className = "" }: { field: ProField; className?: string }) {
  if (!field.placeholder) return <span className={className}>{field.value}</span>;
  return (
    <span className={`${className} inline-flex flex-wrap items-center gap-1.5`} data-placeholder="true">
      <span className="italic text-white/60">{field.value}</span>
      <span className="rounded border border-dashed border-amber-300/50 px-1 font-display text-[9px] tracking-[0.15em] text-amber-200">
        PLACEHOLDER
      </span>
    </span>
  );
}
