/**
 * Trick categories for S.K.A.T.E. games. The challenger picks one at game
 * creation; it is stored immutably on the game doc (mirrors `spotId`). Legacy
 * game docs predate the field and are treated as "any" ("Anything Goes").
 *
 * Categories are an honor-system constraint: the app displays the agreed
 * category through the flow but does not mechanically restrict which tricks a
 * player records. "Team 2v2" is likewise a labeled intent — players self-
 * organize teams; the underlying game is still 1-vs-1. "Custom Rules" reveals a
 * free-text field so the challenger can state their own rules.
 *
 * No Firebase imports here — this is a pure constant/normalization module,
 * safe to consume from services and UI alike.
 */

/** The selectable trick categories, in display order. */
export const TRICK_CATEGORIES = [
  { id: "any", label: "Anything Goes" },
  { id: "flip", label: "Flip Tricks" },
  { id: "grind", label: "Rails & Ledges" },
  { id: "air", label: "Airs & Grabs" },
  { id: "manual", label: "Manuals" },
  { id: "oldschool", label: "Old School" },
  { id: "flatground", label: "Flat Ground" },
  { id: "switch", label: "Only Switch" },
  { id: "flatbar", label: "Flat Bar" },
  { id: "transition", label: "Transition" },
  { id: "team2v2", label: "Team 2v2" },
  { id: "custom", label: "Custom Rules" },
] as const;

/** Union of the valid trick category ids. */
export type TrickCategoryId = (typeof TRICK_CATEGORIES)[number]["id"];

/** The category that reveals a challenger-authored free-text rules field. */
export const CUSTOM_CATEGORY_ID = "custom";

/** Max length for custom-rules text, enforced at the service write boundary. */
export const CUSTOM_RULES_MAX_LENGTH = 120;

/**
 * Defense-in-depth boundary (like `normalizeSpotId`): coerce an untrusted value
 * to a valid `TrickCategoryId`. Returns the value when it is one of the known
 * ids, otherwise falls back to "any".
 */
export function normalizeTrickCategory(raw: unknown): TrickCategoryId {
  return TRICK_CATEGORIES.some((c) => c.id === raw) ? (raw as TrickCategoryId) : "any";
}

/**
 * Sanitize challenger-authored custom-rules text at the service boundary: trim,
 * strip C0/C1 control characters, and cap length. Returns null for a non-string
 * or blank input. Mirrors the trick-name sanitization in `games.match.setTrick`.
 */
export function normalizeCustomRules(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .trim()
    // eslint-disable-next-line no-control-regex -- intentionally stripping C0/C1 control characters
    .replace(/[\x00-\x1F\x7F]/g, "")
    .slice(0, CUSTOM_RULES_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Human-readable label for a trick category id. Falls back to "Anything Goes"
 * for unknown or missing ids (legacy game docs without the field).
 */
export function trickCategoryLabel(id: string | null | undefined): string {
  return TRICK_CATEGORIES.find((c) => c.id === id)?.label ?? "Anything Goes";
}

/**
 * The category text to announce in challenge/notification copy and the in-game
 * constraint hints. Prefers the challenger's custom text for custom-rule games,
 * otherwise the preset label. Returns null when there is nothing to announce —
 * "any" games and legacy docs — so callers can omit the constraint entirely.
 */
export function trickCategoryHeadline(id: string | null | undefined, customRules?: string | null): string | null {
  if (id === CUSTOM_CATEGORY_ID) {
    return customRules && customRules.length > 0 ? customRules : trickCategoryLabel(CUSTOM_CATEGORY_ID);
  }
  if (!id || id === "any") return null;
  return trickCategoryLabel(id);
}
