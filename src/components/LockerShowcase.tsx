import { Boxes, CircleDot, Footprints, HardHat, Layers, Shirt, Sticker, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { LockerItem } from "../services/locker";

/**
 * "Hubba Locker" — the gear a player has earned (Economy Phase A).
 *
 * Empty-state rule: another player's empty locker renders nothing, because a
 * "nothing here yet" card on someone else's profile is noise to every visitor
 * but the owner. The owner instead gets one muted hint so the section isn't a
 * mystery the first time they earn something.
 *
 * `type` and `rarity` arrive as open strings from the service — a later drop
 * can introduce a gear type or tier this build has never seen. Both lookups
 * fall back (generic crate icon / common styling) rather than rendering an
 * unstyled card.
 */

interface Props {
  items: LockerItem[];
  isOwnProfile: boolean;
}

/**
 * Icon shown when an item has no image yet, keyed by gear type. Typed with an
 * optional value so an unrecognised type resolves to `undefined` and falls back
 * to the generic crate rather than rendering an empty box.
 */
const TYPE_ICONS: Readonly<Partial<Record<string, LucideIcon>>> = {
  deck: Layers,
  wheels: CircleDot,
  trucks: Wrench,
  shoes: Footprints,
  shirt: Shirt,
  tee: Shirt,
  hat: HardHat,
  sticker: Sticker,
};

/**
 * Rarity accent classes. Tailwind cannot see dynamically-built class names, so
 * each tier spells its utilities out in full. Uncommon and limited reuse the
 * theme's brand green / orange so the locker sits inside the app's existing
 * palette instead of introducing a second set of accent hues.
 */
const RARITY_STYLES: Readonly<Record<string, { card: string; tag: string }>> = {
  common: { card: "border-zinc-700/70", tag: "bg-zinc-500/15 text-zinc-300" },
  uncommon: { card: "border-brand-green/50", tag: "bg-brand-green/15 text-brand-green" },
  rare: { card: "border-blue-500/50", tag: "bg-blue-500/15 text-blue-400" },
  limited: { card: "border-brand-orange/60", tag: "bg-brand-orange/15 text-brand-orange" },
};

function stylesForRarity(rarity: string): { card: string; tag: string } {
  return Object.hasOwn(RARITY_STYLES, rarity) ? RARITY_STYLES[rarity] : RARITY_STYLES.common;
}

export function LockerShowcase({ items, isOwnProfile }: Props) {
  if (items.length === 0) {
    if (!isOwnProfile) return null;
    return (
      <section aria-label="Hubba Locker" data-testid="locker-showcase" className="mb-8 animate-fade-in">
        <SectionHeading />
        <p
          data-testid="locker-empty-hint"
          className="rounded-2xl border border-dashed border-border px-4 py-6 text-center font-body text-xs text-subtle"
        >
          Your locker is empty — earned gear will show up here
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Hubba Locker" data-testid="locker-showcase" className="mb-8 animate-fade-in">
      <SectionHeading />
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <LockerCard key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

function SectionHeading() {
  return <h2 className="font-display text-[10px] tracking-[0.2em] text-brand-orange mb-3">HUBBA LOCKER</h2>;
}

function LockerCard({ item }: { item: LockerItem }) {
  const rarity = stylesForRarity(item.rarity);
  const Icon = TYPE_ICONS[item.type] ?? Boxes;
  // `brand` and `provenanceReason` are both optional in practice — the service
  // defaults a missing brand to "". Each clause is dropped rather than read out
  // as "Ledge Deck by , common".
  const byBrand = item.brand ? ` by ${item.brand}` : "";
  const detail = item.provenanceReason ? `. ${item.provenanceReason}` : "";

  return (
    <li
      data-testid={`locker-item-${item.id}`}
      aria-label={`${item.name}${byBrand}, ${item.rarity}${detail}`}
      title={item.provenanceReason ?? undefined}
      className={`overflow-hidden rounded-2xl border bg-surface ${rarity.card}`}
    >
      <div className="flex aspect-square items-center justify-center bg-surface-alt">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            aria-hidden="true"
            className="h-full w-full object-cover"
            data-testid={`locker-image-${item.id}`}
          />
        ) : (
          <Icon
            size={28}
            strokeWidth={1.5}
            className="text-faint"
            aria-hidden="true"
            data-testid={`locker-icon-${item.id}`}
          />
        )}
      </div>
      <div className="p-2.5">
        <p className="font-display text-sm leading-tight text-white truncate">{item.name}</p>
        {item.brand && (
          <p className="font-body text-[10px] uppercase tracking-wider text-subtle mt-0.5 truncate">{item.brand}</p>
        )}
        <span
          className={`mt-1.5 inline-block rounded px-1.5 py-0.5 font-display text-[9px] tracking-wider leading-none ${rarity.tag}`}
        >
          {item.rarity.toUpperCase()}
        </span>
      </div>
    </li>
  );
}
