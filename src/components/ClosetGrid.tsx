import { useState } from "react";
import { Boxes, CircleDot, Footprints, HardHat, Layers, Shirt, Sticker, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { LockerItem } from "../services/locker";
import { designerCreditFor } from "../lib/closet/mikeWhiteCollection";
import { DesignerCredit } from "./DesignerCredit";
import { cardArtFor } from "../lib/closet/shoe360";
import { ShoeDetailSheet } from "./ShoeDetailSheet";

/*
 * Closet item cards, shared by the full Closet screen (grid) and the profile's
 * one-row preview (thumbnails).
 *
 * `type` and `rarity` arrive as open strings from the service — a later drop
 * can introduce a gear type or tier this build has never seen. Both lookups
 * fall back (generic crate icon / common styling) rather than rendering an
 * unstyled card.
 */

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
 * each tier spells its utilities out in full. Grail tier added for the closet.
 */
const RARITY_STYLES: Readonly<Record<string, { card: string; tag: string }>> = {
  common: { card: "border-zinc-700/70", tag: "bg-zinc-500/15 text-zinc-300" },
  uncommon: { card: "border-brand-green/50", tag: "bg-brand-green/15 text-brand-green" },
  rare: { card: "border-blue-500/50", tag: "bg-blue-500/15 text-blue-400" },
  limited: { card: "border-brand-orange/60", tag: "bg-brand-orange/15 text-brand-orange" },
  grail: { card: "border-red-500/70", tag: "bg-red-500/15 text-red-400" },
};

function stylesForRarity(rarity: string): { card: string; tag: string } {
  return Object.hasOwn(RARITY_STYLES, rarity) ? RARITY_STYLES[rarity] : RARITY_STYLES.common;
}

/** Newest first; undated items last. */
export function sortClosetItems(items: readonly LockerItem[]): LockerItem[] {
  return [...items].sort((a, b) => (b.acquiredAt?.getTime() ?? 0) - (a.acquiredAt?.getTime() ?? 0));
}

/** Image the card shows: credited designs use the polished card art, whatever URL the locker copy carries. */
function imageFor(item: LockerItem): string | null {
  return designerCreditFor(item.itemDefId) ? cardArtFor(item.itemDefId ?? "") : item.imageUrl;
}

/** Every item as a card grid (the Closet screen). */
export function ClosetGrid({ items }: { items: readonly LockerItem[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4" data-testid="closet-grid">
      {sortClosetItems(items).map((item) => (
        <ClosetCard key={item.id} item={item} />
      ))}
    </ul>
  );
}

/** Small square thumbnail for the profile preview row. Decorative: the row's link carries the label. */
export function ClosetThumb({ item }: { item: LockerItem }) {
  const rarity = stylesForRarity(item.rarity);
  const Icon = TYPE_ICONS[item.type] ?? Boxes;
  const imageUrl = imageFor(item);
  return (
    <li
      data-testid={`closet-thumb-${item.id}`}
      className={`flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-surface-alt ${rarity.card}`}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" loading="lazy" aria-hidden="true" className="h-full w-full object-cover" />
      ) : (
        <Icon size={20} strokeWidth={1.5} className="text-faint" aria-hidden="true" />
      )}
    </li>
  );
}

function ClosetCard({ item }: { item: LockerItem }) {
  const rarity = stylesForRarity(item.rarity);
  const Icon = TYPE_ICONS[item.type] ?? Boxes;
  // `brand` and `provenanceReason` are both optional in practice — the service
  // defaults a missing brand to "". Each clause is dropped rather than read out
  // as "Ledge Deck by , common".
  const byBrand = item.brand ? ` by ${item.brand}` : "";
  const detail = item.provenanceReason ? `. ${item.provenanceReason}` : "";
  const credit = designerCreditFor(item.itemDefId);
  const creditLabel = credit ? `. ${credit.credit}` : "";
  const [open, setOpen] = useState(false);
  const imageUrl = imageFor(item);

  return (
    <li
      data-testid={`closet-item-${item.id}`}
      aria-label={`${item.name}${byBrand}, ${item.rarity}${creditLabel}${detail}`}
      title={item.provenanceReason ?? undefined}
      className={`overflow-hidden rounded-2xl border bg-surface ${rarity.card}`}
    >
      <div className="relative flex aspect-square items-center justify-center bg-surface-alt">
        {credit && (
          <button
            type="button"
            aria-label={`View ${item.name}`}
            data-testid={`closet-view-${item.id}`}
            onClick={() => setOpen(true)}
            className="absolute inset-0 z-10"
          />
        )}
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            aria-hidden="true"
            className="h-full w-full object-cover"
            data-testid={`closet-image-${item.id}`}
          />
        ) : (
          <Icon
            size={28}
            strokeWidth={1.5}
            className="text-faint"
            aria-hidden="true"
            data-testid={`closet-icon-${item.id}`}
          />
        )}
      </div>
      <div className="p-2.5">
        <p className="font-display text-sm leading-tight text-white truncate">{item.name}</p>
        {credit ? (
          <DesignerCredit credit={credit} compact />
        ) : (
          item.brand && (
            <p className="font-body text-label uppercase tracking-wider text-subtle mt-0.5 truncate">{item.brand}</p>
          )
        )}
        <span
          className={`mt-1.5 inline-block rounded px-1.5 py-0.5 font-display text-sm tracking-wider leading-none ${rarity.tag}`}
        >
          {item.rarity.toUpperCase()}
        </span>
      </div>
      {open && credit && (
        <ShoeDetailSheet
          itemDefId={item.itemDefId ?? ""}
          name={item.name}
          credit={credit}
          onClose={() => setOpen(false)}
        />
      )}
    </li>
  );
}
