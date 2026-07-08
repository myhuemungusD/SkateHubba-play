/**
 * Trick categories for S.K.A.T.E. games. The challenger picks one at game
 * creation; it is stored immutably on the game doc (mirrors `spotId`). Legacy
 * game docs predate the field and are treated as "any" ("Anything Goes").
 *
 * No Firebase imports here — this is a pure constant/normalization module,
 * safe to consume from services and UI alike.
 */

/** The six selectable trick categories, in display order. */
export const TRICK_CATEGORIES = [
  { id: "any", label: "Anything Goes" },
  { id: "flip", label: "Flip Tricks" },
  { id: "grind", label: "Rails & Ledges" },
  { id: "air", label: "Airs & Grabs" },
  { id: "manual", label: "Manuals" },
  { id: "oldschool", label: "Old School" },
] as const;

/** Union of the valid trick category ids. */
export type TrickCategoryId = (typeof TRICK_CATEGORIES)[number]["id"];

/**
 * Defense-in-depth boundary (like `normalizeSpotId`): coerce an untrusted value
 * to a valid `TrickCategoryId`. Returns the value when it is one of the six
 * known ids, otherwise falls back to "any".
 */
export function normalizeTrickCategory(raw: unknown): TrickCategoryId {
  return TRICK_CATEGORIES.some((c) => c.id === raw) ? (raw as TrickCategoryId) : "any";
}

/**
 * Human-readable label for a trick category id. Falls back to "Anything Goes"
 * for unknown or missing ids (legacy game docs without the field).
 */
export function trickCategoryLabel(id: string | null | undefined): string {
  return TRICK_CATEGORIES.find((c) => c.id === id)?.label ?? "Anything Goes";
}
