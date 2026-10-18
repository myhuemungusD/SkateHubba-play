/**
 * Mike White Signature collection.
 *
 * Every shoe here was designed by Mike White, drawn by hand in a paint app on
 * his iPhone. The source files live on the `assets/mike-white-shoe` branch
 * under design/closet/; this module is the deduped, shippable set.
 *
 * Credit is not optional: every item carries `designer`, and item cards render
 * "Designed by Mike White" with his signature (see DesignerCredit).
 * Signature items are earn/drop only and never sold for Bucks.
 *
 * Dedupe + content notes live in docs/MIKE_WHITE_COLLECTION.md: repeats and
 * multi-view sheets of the same shoe fold into one item, and mike-raw-6 is
 * left out because the photo includes a cigarette pack.
 */

export const MIKE_WHITE_COLLECTION_ID = "mike_white_signature";
export const MIKE_WHITE_COLLECTION_NAME = "Mike White Signature";
export const MIKE_WHITE_DESIGNER = "Mike White";
export const MIKE_WHITE_SIGNATURE_URL = "/assets/closet/mike-white/signature.png";
export const MIKE_WHITE_CREDIT = "Designed by Mike White";
/** Credit line for anything a skater makes from one of Mike's templates. */
export const MIKE_WHITE_TEMPLATE_CREDIT = "Based on a Mike White design";

export interface DesignerCredit {
  designer: string;
  credit: string;
  signatureUrl: string;
  collectionId: string;
  collectionName: string;
}

export const MIKE_WHITE_DESIGNER_CREDIT: DesignerCredit = {
  designer: MIKE_WHITE_DESIGNER,
  credit: MIKE_WHITE_CREDIT,
  signatureUrl: MIKE_WHITE_SIGNATURE_URL,
  collectionId: MIKE_WHITE_COLLECTION_ID,
  collectionName: MIKE_WHITE_COLLECTION_NAME,
};

export interface MikeWhiteItem {
  itemDefId: string;
  name: string;
  colorway: string;
  type: "shoes";
  slot: "shoes";
  rarity: "limited";
  artUrl: string;
  layerUrls: { front: string; back: null };
  model3dUrl: null;
  edition: { kind: "limited"; supply: number; minted: 0; soldOut: false };
  source: "pro_signature";
  priceBucks: null;
  dropId: null;
  licensed: { brand: string; licenseRef: string };
  releasedAt: null;
  retiredAt: null;
  designer: DesignerCredit;
}

/** [itemDefId, model name, colorway]. Order is the collection display order. */
const DESIGNS: ReadonlyArray<readonly [string, string, string]> = [
  ["mike_white_signature_001", "Mike White Signature", "Tan / White / Navy"],
  ["mike_white_m_navy_gold", "M-Logo Low", "Navy / Gold"],
  ["mike_white_m_red_grey", "M-Logo Low", "Red / Grey"],
  ["mike_white_m_blackout", "M-Logo Low", "Blackout"],
  ["mike_white_ice_bolt", "Bolt Runner", "Black / Ice"],
  ["mike_white_shadow_runner", "Shadow Runner", "Black / Silver"],
  ["mike_white_gold_trim", "Gold Trim Low", "Black / Gold"],
  ["mike_white_creamsicle", "Creamsicle", "White / Orange"],
  ["mike_white_slate_ember", "Slate Ember", "Grey / Black / Rust"],
  ["mike_white_redline", "Redline", "Black / Red"],
  ["mike_white_desert_stripe", "Desert Stripe", "Brown / Sand"],
  ["mike_white_teeth_ghost", "Teeth", "Ghost White"],
  ["mike_white_teeth_fire", "Teeth", "Fire Red"],
  ["mike_white_teeth_wave", "Teeth", "White / Royal / Gold"],
  ["mike_white_pbjs", "PB&J's", "Purple / Peach"],
  ["mike_white_true_blues", "True Blues", "Royal Blue"],
  ["mike_white_dip_sets", "Dip Sets", "Black / White"],
  ["mike_white_og_gum", "OG Signature", "Black / Gum"],
  ["mike_white_laced_black", "Laced Low", "Black / Orange"],
  ["mike_white_camo_moss", "Moss Camo", "Olive / Tan"],
  ["mike_white_panda_wave", "Wave Runner", "Black / White"],
  ["mike_white_charcoal_wave", "Wave Runner", "Charcoal / Red"],
  ["mike_white_cloud_strap", "Cloud Strap", "Grey / Red"],
  ["mike_white_oxblood", "Oxblood Slip", "Oxblood"],
  ["mike_white_slip_gum", "Slip Low", "Black / Gum"],
  ["mike_white_slip_white", "Slip Low", "White / Red"],
  ["mike_white_slip_camo", "Slip Low", "Black / Camo"],
  ["mike_white_slip_teal", "Slip Low", "Black / Teal"],
  ["mike_white_slip_bred", "Slip Low", "Black / Red"],
  ["mike_white_mw_patch_bred", "MW Patch", "Black / Red"],
  ["mike_white_mw_patch_navy", "MW Patch", "Navy / Orange"],
  ["mike_white_mw_patch_brown", "MW Patch", "Brown / Gold"],
  ["mike_white_royal_stripe", "Royal Stripe", "Navy / White"],
  ["mike_white_night_strap", "Night Strap", "Black / White / Purple"],
  ["mike_white_heel_loop_white_red", "Heel Loop Low", "White / Red / Grey"],
  ["mike_white_claw_runner", "Claw Runner", "Black / Orange"],
  ["mike_white_claw_runner_royal", "Claw Runner", "White / Royal / Yellow"],
];

function artFor(itemDefId: string): string {
  return `/assets/closet/mike-white/${itemDefId.replace(/_/g, "-")}.webp`;
}

/** Polished card (shared backdrop, crop, shadow); see scripts/closet/build_shoe_skins.py. */
function cardFor(itemDefId: string): string {
  return `/assets/closet/mike-white/card/${itemDefId.replace(/^mike_white_/, "").replace(/_/g, "-")}.webp`;
}

export const MIKE_WHITE_COLLECTION: readonly MikeWhiteItem[] = DESIGNS.map(([itemDefId, name, colorway]) => ({
  itemDefId,
  name: `${name} — ${colorway}`,
  colorway,
  type: "shoes",
  slot: "shoes",
  rarity: "limited",
  artUrl: cardFor(itemDefId),
  layerUrls: { front: artFor(itemDefId), back: null },
  model3dUrl: null,
  edition: { kind: "limited", supply: 1000, minted: 0, soldOut: false },
  source: "pro_signature",
  priceBucks: null,
  dropId: null,
  licensed: { brand: MIKE_WHITE_DESIGNER, licenseRef: `mike_white_license_${itemDefId}` },
  releasedAt: null,
  retiredAt: null,
  designer: MIKE_WHITE_DESIGNER_CREDIT,
}));

/** The original shoe Mike sent first; kept under its launch id. */
export const MIKE_WHITE_SIGNATURE_SHOE = MIKE_WHITE_COLLECTION[0];

const BY_ID = new Map(MIKE_WHITE_COLLECTION.map((item) => [item.itemDefId, item]));

/**
 * Credit for an item definition, or null when it isn't a credited design.
 * Lookup is by itemDefId so a locker copy keeps its credit after a trade.
 */
export function designerCreditFor(itemDefId: string | null | undefined): DesignerCredit | null {
  if (!itemDefId) return null;
  return BY_ID.get(itemDefId)?.designer ?? null;
}

/** closetAdmin createItem payloads for seeding the whole collection. */
export function mikeWhiteSeedActions() {
  return MIKE_WHITE_COLLECTION.map((item) => ({
    action: "createItem" as const,
    params: { itemDefId: item.itemDefId, item },
  }));
}
