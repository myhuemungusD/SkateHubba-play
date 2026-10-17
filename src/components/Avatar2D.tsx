/**
 * 2D layered avatar — Phase 1 avatar system (Bitmoji-style).
 * Renders equipped closet items as stacked layers. Plan §8 Phase 1.
 *
 * Each item's layerUrls.front is composited in z-order: back accessory,
 * deck, bottoms, shoes, top, head. The base body is always shown beneath
 * all layers. 3D (Phase 2) reuses Skate Runner's .glb rig.
 */
import { User } from "lucide-react";
import type { LockerItem } from "../services/locker";

interface Props {
  equippedItems: LockerItem[];
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES = {
  sm: "w-16 h-16",
  md: "w-24 h-24",
  lg: "w-32 h-32",
};

/**
 * Z-order for layered composition. Items render in this order (back to front).
 * Matches the slot order in model.ts.
 */
const SLOT_ORDER: Record<string, number> = {
  accessory: 0,
  deck: 1,
  bottom: 2,
  shoes: 3,
  top: 4,
  head: 5,
};

export function Avatar2D({ equippedItems, size = "md", className = "" }: Props) {
  const sortedItems = [...equippedItems].sort((a, b) => {
    const aOrder = SLOT_ORDER[a.type] ?? 99;
    const bOrder = SLOT_ORDER[b.type] ?? 99;
    return aOrder - bOrder;
  });

  const hasLayers = sortedItems.some((item) => item.imageUrl);

  return (
    <div className={`relative ${SIZE_CLASSES[size]} ${className}`} data-testid="avatar-2d" aria-label="Player avatar">
      {hasLayers ? (
        <div className="relative w-full h-full rounded-full overflow-hidden bg-surface-alt">
          {sortedItems.map((item) => {
            if (!item.imageUrl) return null;
            return (
              <img
                key={item.id}
                src={item.imageUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
                style={{ zIndex: SLOT_ORDER[item.type] ?? 0 }}
                aria-hidden="true"
              />
            );
          })}
        </div>
      ) : (
        <div
          className="flex w-full h-full items-center justify-center rounded-full bg-surface-alt border border-border"
          data-testid="avatar-empty"
        >
          <User size={size === "sm" ? 24 : size === "md" ? 36 : 48} className="text-faint" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
