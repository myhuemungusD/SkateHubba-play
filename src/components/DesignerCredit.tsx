import type { DesignerCredit as Credit } from "../lib/closet/mikeWhiteCollection";

/**
 * Designer credit for an item card: "Designed by …", the designer's own
 * signature, and the collection it belongs to. Shown on every credited item,
 * wherever the card renders (closet, shop, trades).
 */
export function DesignerCredit({ credit, compact = false }: { credit: Credit; compact?: boolean }) {
  return (
    <div className="mt-1" data-testid="designer-credit">
      <p className={`font-body uppercase tracking-wider text-brand-orange ${compact ? "text-[9px]" : "text-[11px]"}`}>
        {credit.credit}
      </p>
      <img
        src={credit.signatureUrl}
        alt={`${credit.designer} signature`}
        loading="lazy"
        className={compact ? "h-4 w-auto mt-0.5" : "h-6 w-auto mt-1"}
      />
      <p className={`font-body text-subtle truncate ${compact ? "text-[9px]" : "text-[11px]"}`}>
        {credit.collectionName} collection
      </p>
    </div>
  );
}
