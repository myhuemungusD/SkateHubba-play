import type { LockerItem } from "../../../../services/locker";
import { designerCreditFor, MIKE_WHITE_COLLECTION_NAME } from "../../../../lib/closet/mikeWhiteCollection";
import { DesignerCredit } from "../../../../components/DesignerCredit";
import { Shoe360 } from "../../../../components/Shoe360";
import { cardArtFor, shoeSkinFor } from "../../../../lib/closet/shoe360";

/**
 * Highlights signature-collection items (Mike White Signature) the player
 * owns, each with its designer credit. Nothing when they own none.
 */
export function SignatureShowcase({ items, accent }: { items: LockerItem[]; accent: string }) {
  const credited = items
    .map((item) => ({ item, id: item.itemDefId ?? "", credit: designerCreditFor(item.itemDefId) }))
    .filter((x): x is { item: LockerItem; id: string; credit: NonNullable<typeof x.credit> } => x.credit !== null)
    .slice(0, 6);
  if (credited.length === 0) return null;
  // One 360 hero (first piece with a skin) keeps it to a single WebGL context.
  const hero = credited.find(({ item }) => shoeSkinFor(item.itemDefId) !== null);
  return (
    <section aria-label={MIKE_WHITE_COLLECTION_NAME} data-testid="signature-showcase" className="mb-8">
      <h3 className="mb-3 font-display text-[11px] tracking-[0.2em]" style={{ color: accent }}>
        SIGNATURE PIECES
      </h3>
      {hero && (
        <div className="mb-2 rounded-xl border border-border bg-surface p-2" data-testid="signature-hero">
          <Shoe360 itemDefId={hero.id} imageUrl={cardArtFor(hero.id)} alt={hero.item.name} />
          <p className="mt-1 truncate font-body text-[12px] text-white/90">{hero.item.name}</p>
          <DesignerCredit credit={hero.credit} compact />
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {credited.map(({ item, id, credit }) => (
          <div key={item.id} className="rounded-xl border border-border bg-surface p-2">
            <img
              src={cardArtFor(id)}
              alt={item.name}
              loading="lazy"
              className="aspect-square w-full rounded-lg object-cover"
            />
            <p className="mt-1 truncate font-body text-[11px] text-white/90">{item.name}</p>
            <DesignerCredit credit={credit} compact />
          </div>
        ))}
      </div>
    </section>
  );
}
