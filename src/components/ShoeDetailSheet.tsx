import { useEffect } from "react";
import { X } from "lucide-react";
import type { DesignerCredit as Credit } from "../lib/closet/mikeWhiteCollection";
import { cardArtFor } from "../lib/closet/shoe360";
import { DesignerCredit } from "./DesignerCredit";
import { Shoe360 } from "./Shoe360";

/**
 * Item detail for a credited signature shoe: the 360 view (or the polished
 * 2D card), the name, and the designer credit with signature. Escape or the
 * backdrop closes it.
 */
export function ShoeDetailSheet({
  itemDefId,
  name,
  credit,
  onClose,
}: {
  itemDefId: string;
  name: string;
  credit: Credit;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={name}
        data-testid="shoe-detail"
        className="w-full max-w-md rounded-t-3xl border border-border bg-surface p-4 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <p className="font-display text-lg leading-tight text-white">{name}</p>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center text-subtle hover:text-white"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <Shoe360 itemDefId={itemDefId} imageUrl={cardArtFor(itemDefId)} alt={name} />
        <DesignerCredit credit={credit} />
      </div>
    </div>
  );
}
