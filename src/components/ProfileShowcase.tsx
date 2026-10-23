/**
 * Profile showcase — avatar wearing equipped items + 6 pinned items.
 * Plan §7: "Showcase shelf" for high-value items, serials visible.
 */
import { Avatar2D } from "./Avatar2D";
import type { LockerItem } from "../services/locker";

interface Props {
  equippedItems: LockerItem[];
  pinnedItems: LockerItem[];
  isOwnProfile: boolean;
}

export function ProfileShowcase({ equippedItems, pinnedItems, isOwnProfile }: Props) {
  if (equippedItems.length === 0 && pinnedItems.length === 0) {
    if (!isOwnProfile) return null;
    return (
      <section aria-label="Showcase" data-testid="profile-showcase" className="mb-8">
        <SectionHeading />
        <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
          <p className="font-body text-xs text-subtle">Your showcase is empty — equip items to show them off</p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Showcase" data-testid="profile-showcase" className="mb-8 animate-fade-in">
      <SectionHeading />
      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        {/* Avatar wearing equipped items */}
        <div className="flex items-center justify-center py-8 bg-surface-alt/30">
          <Avatar2D equippedItems={equippedItems} size="lg" />
        </div>

        {/* Pinned items shelf */}
        {pinnedItems.length > 0 && (
          <div className="p-4 border-t border-border">
            <h3 className="font-display text-[10px] tracking-[0.2em] text-subtle mb-3 uppercase">Showcase</h3>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {pinnedItems.slice(0, 6).map((item) => (
                <ShowcaseItemCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SectionHeading() {
  return <h2 className="font-display text-[10px] tracking-[0.2em] text-brand-orange mb-3">SHOWCASE</h2>;
}

function ShowcaseItemCard({ item }: { item: LockerItem }) {
  const rarityColors: Record<string, string> = {
    common: "border-zinc-700/70",
    uncommon: "border-brand-green/50",
    rare: "border-blue-500/50",
    limited: "border-brand-orange/60",
    grail: "border-red-500/70",
  };

  return (
    <div
      className={`aspect-square rounded-lg border bg-surface-alt overflow-hidden ${rarityColors[item.rarity] ?? rarityColors.common}`}
      title={item.name}
      data-testid={`showcase-item-${item.id}`}
    >
      {item.imageUrl ? (
        <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
      ) : (
        <div className="flex items-center justify-center w-full h-full text-faint">
          <span className="text-xs">{item.name.charAt(0)}</span>
        </div>
      )}
    </div>
  );
}
