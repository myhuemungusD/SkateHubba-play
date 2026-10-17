import type { LockerItem } from "../../../../services/locker";
import { designerCreditFor, MIKE_WHITE_COLLECTION_NAME } from "../../../../lib/closet/mikeWhiteCollection";
import { DesignerCredit } from "../../../../components/DesignerCredit";

/**
 * Highlights signature-collection items (Mike White Signature) the player
 * owns, each with its designer credit. Nothing when they own none.
 */
export function SignatureShowcase({ items, accent }: { items: LockerItem[]; accent: string }) {
  const credited = items
    .map((item) => ({ item, credit: designerCreditFor(item.itemDefId) }))
    .filter((x): x is { item: LockerItem; credit: NonNullable<typeof x.credit> } => x.credit !== null)
    .slice(0, 6);
  if (credited.length === 0) return null;
  return (
    <section aria-label={MIKE_WHITE_COLLECTION_NAME} data-testid="signature-showcase" className="mb-8">
      <h3 className="mb-3 font-display text-[11px] tracking-[0.2em]" style={{ color: accent }}>
        SIGNATURE PIECES
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {credited.map(({ item, credit }) => (
          <div key={item.id} className="rounded-xl border border-border bg-surface p-2">
            {item.imageUrl && (
              <img src={item.imageUrl} alt={item.name} loading="lazy" className="aspect-square w-full object-contain" />
            )}
            <p className="mt-1 truncate font-body text-[11px] text-white/90">{item.name}</p>
            <DesignerCredit credit={credit} compact />
          </div>
        ))}
      </div>
    </section>
  );
}
