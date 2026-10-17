/**
 * Mike White Signature Shoe - Catalog Item Definition
 *
 * This is a pro signature item designed by Mike White.
 * Earnable/drop only, never purchasable.
 */
export const MIKE_WHITE_SIGNATURE_SHOE = {
  itemDefId: "mike_white_signature_001",
  name: "Mike White Signature",
  type: "shoes",
  slot: "shoes" as const,
  rarity: "limited" as const,
  artUrl: "/assets/closet/shoes/mike-white-signature-card.png",
  layerUrls: {
    front: "/assets/closet/shoes/mike-white-signature-avatar.png",
    back: null,
  },
  model3dUrl: null,
  edition: {
    kind: "limited" as const,
    supply: 1000,
    minted: 0,
    soldOut: false,
  },
  source: "pro_signature" as const,
  priceBucks: null, // Not purchasable
  dropId: null, // Can be assigned to a drop later
  licensed: {
    brand: "Mike White",
    licenseRef: "mike_white_signature_license_001",
  },
  releasedAt: null, // Not released yet
  retiredAt: null,
  metadata: {
    designer: "Mike White",
    colorway: "Tan/White/Navy",
    features: "Yellow laces, black-on-yellow triangle logo",
    category: "pro_signature",
    earnable: true,
    purchasable: false,
  },
} as const;

/**
 * Server-side function to create the Mike White shoe in the catalog.
 * Run via closetAdmin callable once deployed.
 *
 * Example:
 * ```ts
 * await closetAdmin({
 *   action: "createItem",
 *   params: {
 *     itemDefId: MIKE_WHITE_SIGNATURE_SHOE.itemDefId,
 *     item: MIKE_WHITE_SIGNATURE_SHOE
 *   }
 * });
 * ```
 */
export function createMikeWhiteShoeItem() {
  return {
    action: "createItem" as const,
    params: {
      itemDefId: MIKE_WHITE_SIGNATURE_SHOE.itemDefId,
      item: MIKE_WHITE_SIGNATURE_SHOE,
    },
  };
}
