import { ChevronRight } from "lucide-react";
import type { LockerItem } from "../services/locker";
import { isClosetStudioEnabled } from "../lib/featureFlags";
import { ClosetThumb, sortClosetItems } from "./ClosetGrid";

/**
 * Profile "Closet" row — the gear a player has earned (Economy Phase A).
 *
 * The profile shows one compact row: the item count, at most one row of
 * thumbnails, and "See all", which opens the full grid on its own screen. The
 * full list used to render here and buried the rest of the profile.
 *
 * Empty-state rule: another player's empty locker renders nothing, because a
 * "nothing here yet" card on someone else's profile is noise to every visitor
 * but the owner. The owner instead gets one muted hint so the section isn't a
 * mystery the first time they earn something.
 */

/** Most thumbnails in the preview row (one row at 390pt wide). */
export const CLOSET_PREVIEW_COUNT = 4;

interface Props {
  items: LockerItem[];
  isOwnProfile: boolean;
  /** Opens the full Closet screen. Omit and the row shows no "See all". */
  onSeeAll?: () => void;
}

export function ClosetShowcase({ items, isOwnProfile, onSeeAll }: Props) {
  if (items.length === 0) {
    if (!isOwnProfile) return null;
    return (
      <section aria-label="Closet" data-testid="closet-showcase" className="mb-8 animate-fade-in">
        <SectionHeading own={isOwnProfile} />
        <p
          data-testid="closet-empty-hint"
          className="rounded-2xl border border-dashed border-border px-4 py-6 text-center font-body text-xs text-subtle"
        >
          Your closet is empty — earned gear will show up here
        </p>
      </section>
    );
  }

  const preview = sortClosetItems(items).slice(0, CLOSET_PREVIEW_COUNT);
  const countLabel = items.length === 1 ? "1 item" : `${items.length} items`;

  return (
    <section aria-label="Closet" data-testid="closet-showcase" className="mb-8 animate-fade-in">
      <SectionHeading own={isOwnProfile} />
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-3">
        <ul className="flex min-w-0 flex-1 gap-2 overflow-hidden" aria-hidden="true" data-testid="closet-preview">
          {preview.map((item) => (
            <ClosetThumb key={item.id} item={item} />
          ))}
        </ul>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-body text-xs text-muted tabular-nums" data-testid="closet-count">
            {countLabel}
          </span>
          {onSeeAll && (
            <button
              type="button"
              onClick={onSeeAll}
              data-testid="closet-see-all"
              aria-label={`See all ${countLabel} in the closet`}
              className="-mr-1 inline-flex min-h-11 items-center gap-0.5 rounded-lg px-1 font-display text-xs tracking-wider text-brand-orange hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            >
              See all
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function SectionHeading({ own = false }: { own?: boolean }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">CLOSET</h2>
      {own && isClosetStudioEnabled() && (
        <a
          href="/closet/studio"
          className="font-body text-[11px] text-white underline"
          data-testid="open-closet-studio"
        >
          Closet Studio
        </a>
      )}
    </div>
  );
}
