/**
 * Canonical trick catalog for the searchable picker.
 *
 * This is the list a future trick recognizer will be trained against.
 * Game docs still store `currentTrickName` as the human display name so
 * older screens, history, and notifications keep working. The structured
 * fields (`trickId`, `stance`, `obstacle`) live beside it.
 *
 * "other" is not a catalog row. It is the fallback id, and the free text
 * goes in `trickNameCustom` rather than overloading `trickId`.
 */

export const TRICK_STANCES = ["regular", "fakie", "nollie", "switch"] as const;
export type TrickStance = (typeof TRICK_STANCES)[number];

export const TRICK_OBSTACLES = ["flat", "ledge", "rail", "stairs", "gap", "bank", "transition", "manual-pad"] as const;
export type TrickObstacle = (typeof TRICK_OBSTACLES)[number];

export const TRICK_CATALOG_CATEGORIES = [
  { id: "flip", label: "Flips" },
  { id: "shuv", label: "Shuvs" },
  { id: "spin", label: "180s & 360s" },
  { id: "grind", label: "Grinds" },
  { id: "slide", label: "Slides" },
  { id: "manual", label: "Manuals" },
  { id: "air", label: "Airs" },
] as const;
export type TrickCatalogCategory = (typeof TRICK_CATALOG_CATEGORIES)[number]["id"];

export interface CatalogTrick {
  id: string;
  name: string;
  category: TrickCatalogCategory;
  /** Extra search phrases, lowercase. */
  aliases?: readonly string[];
}

/** Shown first when the skater has not typed a search. Order is the ranking. */
export const POPULAR_TRICK_IDS = [
  "ollie",
  "kickflip",
  "heelflip",
  "tre-flip",
  "pop-shove-it",
  "varial-kickflip",
  "bs-180",
  "fs-180",
  "50-50",
  "boardslide",
  "manual",
  "indy",
] as const;

export const OTHER_TRICK_ID = "other";

/** Display names stay inside the 64-character game-doc cap. */
export const TRICK_NAME_MAX = 64;

const STANCE_PREFIX: Record<TrickStance, string> = {
  regular: "",
  fakie: "Fakie ",
  nollie: "Nollie ",
  switch: "Switch ",
};

export const OBSTACLE_LABELS: Record<TrickObstacle, string> = {
  flat: "Flat",
  ledge: "Ledge",
  rail: "Rail",
  stairs: "Stairs",
  gap: "Gap",
  bank: "Bank",
  transition: "Transition",
  "manual-pad": "Manual pad",
};

export const STANCE_LABELS: Record<TrickStance, string> = {
  regular: "Regular",
  fakie: "Fakie",
  nollie: "Nollie",
  switch: "Switch",
};

export const TRICKS: readonly CatalogTrick[] = [
  { id: "ollie", name: "Ollie", category: "flip", aliases: ["ollie"] },
  { id: "kickflip", name: "Kickflip", category: "flip", aliases: ["kick flip", "kf"] },
  { id: "heelflip", name: "Heelflip", category: "flip", aliases: ["heel flip", "hf"] },
  { id: "tre-flip", name: "Tre Flip", category: "flip", aliases: ["360 flip", "3 flip", "treflip"] },
  { id: "varial-kickflip", name: "Varial Kickflip", category: "flip", aliases: ["varial"] },
  { id: "varial-heelflip", name: "Varial Heelflip", category: "flip" },
  { id: "hardflip", name: "Hardflip", category: "flip" },
  { id: "inward-heelflip", name: "Inward Heelflip", category: "flip", aliases: ["inward heel"] },
  { id: "360-flip", name: "360 Flip", category: "flip" },
  { id: "laser-flip", name: "Laser Flip", category: "flip" },
  { id: "nightmare-flip", name: "Nightmare Flip", category: "flip" },
  { id: "double-kickflip", name: "Double Kickflip", category: "flip" },
  { id: "double-heelflip", name: "Double Heelflip", category: "flip" },
  { id: "hospital-flip", name: "Hospital Flip", category: "flip" },
  { id: "forward-flip", name: "Forward Flip", category: "flip" },
  { id: "impossible", name: "Impossible", category: "flip" },
  { id: "kickflip-underflip", name: "Kickflip Underflip", category: "flip" },
  { id: "heelflip-underflip", name: "Heelflip Underflip", category: "flip" },

  { id: "pop-shove-it", name: "Pop Shove-it", category: "shuv", aliases: ["pop shove", "shove it", "shuvit"] },
  { id: "fs-pop-shove-it", name: "FS Pop Shove-it", category: "shuv", aliases: ["frontside shove"] },
  { id: "360-shove-it", name: "360 Shove-it", category: "shuv", aliases: ["360 shove", "tre shove"] },
  { id: "fs-360-shove-it", name: "FS 360 Shove-it", category: "shuv" },
  { id: "bigspin", name: "Bigspin", category: "shuv", aliases: ["big spin"] },
  { id: "fs-bigspin", name: "FS Bigspin", category: "shuv" },
  { id: "bigger-spin", name: "Bigger Spin", category: "shuv" },
  { id: "pressure-flip", name: "Pressure Flip", category: "shuv" },

  { id: "bs-180", name: "BS 180", category: "spin", aliases: ["backside 180"] },
  { id: "fs-180", name: "FS 180", category: "spin", aliases: ["frontside 180"] },
  { id: "bs-360", name: "BS 360", category: "spin", aliases: ["backside 360"] },
  { id: "fs-360", name: "FS 360", category: "spin", aliases: ["frontside 360"] },
  { id: "half-cab", name: "Half Cab", category: "spin", aliases: ["halfcab"] },
  { id: "full-cab", name: "Full Cab", category: "spin", aliases: ["fullcab"] },
  { id: "bs-540", name: "BS 540", category: "spin" },
  { id: "fs-540", name: "FS 540", category: "spin" },
  { id: "gazelle", name: "Gazelle", category: "spin" },
  { id: "bs-bigspin", name: "BS Bigspin", category: "spin" },

  { id: "50-50", name: "50-50", category: "grind", aliases: ["5050", "fifty fifty"] },
  { id: "5-0", name: "5-0", category: "grind", aliases: ["50 grind", "five-o", "five o"] },
  { id: "nosegrind", name: "Nosegrind", category: "grind" },
  { id: "crooked", name: "Crooked", category: "grind", aliases: ["crooks", "crooked grind"] },
  { id: "overcrook", name: "Overcrook", category: "grind" },
  { id: "smith", name: "Smith", category: "grind", aliases: ["smith grind"] },
  { id: "feeble", name: "Feeble", category: "grind" },
  { id: "salad", name: "Salad", category: "grind", aliases: ["salad grind"] },
  { id: "suski", name: "Suski", category: "grind" },
  { id: "blunt", name: "Blunt", category: "grind", aliases: ["blunt grind"] },
  { id: "noseblunt", name: "Noseblunt", category: "grind" },
  { id: "willy", name: "Willy", category: "grind", aliases: ["willy grind"] },

  { id: "boardslide", name: "Boardslide", category: "slide", aliases: ["board slide"] },
  { id: "noseslide", name: "Noseslide", category: "slide", aliases: ["nose slide"] },
  { id: "tailslide", name: "Tailslide", category: "slide", aliases: ["tail slide"] },
  { id: "lipslide", name: "Lipslide", category: "slide", aliases: ["lip slide"] },
  { id: "blunt-slide", name: "Blunt Slide", category: "slide" },
  { id: "noseblunt-slide", name: "Noseblunt Slide", category: "slide" },
  { id: "darkslide", name: "Darkslide", category: "slide" },
  { id: "hurricane", name: "Hurricane", category: "slide" },

  { id: "manual", name: "Manual", category: "manual", aliases: ["manny"] },
  { id: "nose-manual", name: "Nose Manual", category: "manual", aliases: ["nose manual", "nose manny"] },
  { id: "one-foot-manual", name: "One-Foot Manual", category: "manual" },
  { id: "casper", name: "Casper", category: "manual" },
  { id: "primo", name: "Primo", category: "manual" },
  { id: "spacewalk", name: "Spacewalk", category: "manual" },

  { id: "indy", name: "Indy", category: "air", aliases: ["indy grab"] },
  { id: "melon", name: "Melon", category: "air", aliases: ["melon grab"] },
  { id: "mute", name: "Mute", category: "air", aliases: ["mute grab"] },
  { id: "stalefish", name: "Stalefish", category: "air" },
  { id: "tailgrab", name: "Tailgrab", category: "air", aliases: ["tail grab"] },
  { id: "nosegrab", name: "Nosegrab", category: "air", aliases: ["nose grab"] },
  { id: "method", name: "Method", category: "air", aliases: ["method air"] },
  { id: "japan", name: "Japan", category: "air", aliases: ["japan air"] },
  { id: "rocket", name: "Rocket", category: "air", aliases: ["rocket air"] },
  { id: "christ-air", name: "Christ Air", category: "air" },
  { id: "benihana", name: "Benihana", category: "air" },
  { id: "air", name: "Air", category: "air", aliases: ["ollie air"] },
];

const TRICK_BY_ID = new Map(TRICKS.map((trick) => [trick.id, trick]));
const POPULAR_RANK = new Map<string, number>(POPULAR_TRICK_IDS.map((id, index) => [id, index]));

export function trickById(id: string): CatalogTrick | undefined {
  return TRICK_BY_ID.get(id);
}

export function isTrickStance(value: unknown): value is TrickStance {
  return typeof value === "string" && (TRICK_STANCES as readonly string[]).includes(value);
}

export function isTrickObstacle(value: unknown): value is TrickObstacle {
  return typeof value === "string" && (TRICK_OBSTACLES as readonly string[]).includes(value);
}

export interface TrickSelection {
  trickId: string;
  stance: TrickStance;
  obstacle: TrickObstacle | null;
  trickNameCustom: string | null;
}

/** Trim, drop control characters, cap length. Blank becomes null. */
export function sanitizeTrickCustom(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .trim()
    // eslint-disable-next-line no-control-regex -- strip C0/C1 so a custom name can't smuggle controls
    .replace(/[\x00-\x1F\x7F]/g, "")
    .slice(0, TRICK_NAME_MAX);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Human name written to `currentTrickName`. Regular omits the stance word,
 * matching how skaters say the trick. Other stances are prefixed.
 */
export function formatTrickDisplayName(selection: TrickSelection): string {
  const custom = sanitizeTrickCustom(selection.trickNameCustom);
  const base = selection.trickId === OTHER_TRICK_ID ? (custom ?? "") : (trickById(selection.trickId)?.name ?? "");
  const prefix = STANCE_PREFIX[selection.stance] ?? "";
  return `${prefix}${base}`.trim().slice(0, TRICK_NAME_MAX);
}

/** True when the selection is safe to store. Unknown catalog ids are rejected. */
export function isValidTrickSelection(selection: TrickSelection): boolean {
  if (!isTrickStance(selection.stance)) return false;
  if (selection.obstacle !== null && !isTrickObstacle(selection.obstacle)) return false;
  if (selection.trickId === OTHER_TRICK_ID) {
    return sanitizeTrickCustom(selection.trickNameCustom) !== null;
  }
  if (!trickById(selection.trickId)) return false;
  return selection.trickNameCustom === null || sanitizeTrickCustom(selection.trickNameCustom) === null;
}

export interface TrickPickerRow {
  kind: "header" | "trick";
  id: string;
  label: string;
  trick?: CatalogTrick;
}

function matchesQuery(trick: CatalogTrick, query: string): boolean {
  if (trick.name.toLowerCase().includes(query)) return true;
  if (trick.id.includes(query)) return true;
  return (trick.aliases ?? []).some((alias) => alias.includes(query));
}

function byName(a: CatalogTrick, b: CatalogTrick): number {
  return a.name.localeCompare(b.name);
}

/**
 * Trick confusion map for WTT quiz option generation.
 * Maps each trick to commonly confused alternatives for meaningful distractors.
 * Based on Reddit r/NewSkaters analysis and skater input.
 */
export const TRICK_CONFUSION_MAP: Record<string, string[]> = {
  // Flip tricks: kickflip ↔ heelflip ↔ varial variants
  kickflip: ["heelflip", "varial-kickflip", "hardflip", "inward-heelflip"],
  heelflip: ["kickflip", "varial-heelflip", "inward-heelflip", "hardflip"],
  "varial-kickflip": ["kickflip", "hardflip", "varial-heelflip", "tre-flip"],
  "varial-heelflip": ["heelflip", "inward-heelflip", "varial-kickflip", "laser-flip"],
  hardflip: ["kickflip", "varial-kickflip", "inward-heelflip", "tre-flip"],
  "inward-heelflip": ["pressure-flip", "heelflip", "varial-heelflip", "hardflip"],
  "pressure-flip": ["inward-heelflip", "pop-shove-it", "impossible", "heelflip"],

  // Hospital vs. Casper (notorious pair)
  "hospital-flip": ["kickflip", "impossible", "forward-flip"],
  "forward-flip": ["hospital-flip", "kickflip", "impossible"],

  // Tre flip vs. 360 variants
  "tre-flip": ["360-shove-it", "laser-flip", "varial-kickflip", "hardflip"],
  "laser-flip": ["tre-flip", "360-shove-it", "varial-heelflip", "fs-360-shove-it"],

  // Shuvs: 360 shuv ↔ 360 flip
  "pop-shove-it": ["fs-pop-shove-it", "360-shove-it", "pressure-flip", "ollie"],
  "fs-pop-shove-it": ["pop-shove-it", "fs-360-shove-it", "bigspin", "fs-180"],
  "360-shove-it": ["tre-flip", "fs-360-shove-it", "pop-shove-it", "bigspin"],
  "fs-360-shove-it": ["360-shove-it", "laser-flip", "fs-pop-shove-it", "fs-bigspin"],
  bigspin: ["360-shove-it", "bs-180", "fs-bigspin", "bigger-spin"],
  "fs-bigspin": ["bigspin", "fs-360", "fs-360-shove-it", "bigger-spin"],

  // Spins: 180s and 360s
  "bs-180": ["fs-180", "half-cab", "bigspin", "ollie"],
  "fs-180": ["bs-180", "fs-pop-shove-it", "fs-360", "ollie"],
  "bs-360": ["fs-360", "full-cab", "bs-540", "bs-180"],
  "fs-360": ["bs-360", "fs-bigspin", "fs-540", "fs-180"],
  "half-cab": ["full-cab", "bs-180", "fakie-ollie", "bs-360"],
  "full-cab": ["half-cab", "bs-360", "bs-540", "fakie-ollie"],

  // Grinds: 50-50 ↔ 5-0 ↔ nosegrind ↔ crooked
  "50-50": ["5-0", "nosegrind", "overcrook", "feeble"],
  "5-0": ["50-50", "nosegrind", "tailslide", "smith"],
  nosegrind: ["50-50", "5-0", "overcrook", "crooked-grind"],
  "crooked-grind": ["nosegrind", "overcrook", "k-grind", "noseslide"],
  "k-grind": ["crooked-grind", "nosegrind", "overcrook", "noseslide"],
  overcrook: ["crooked-grind", "nosegrind", "k-grind", "50-50"],
  smith: ["feeble", "5-0", "tailslide", "salad-grind"],
  feeble: ["smith", "50-50", "tailslide", "salad-grind"],
  "salad-grind": ["smith", "feeble", "hurricane", "suski"],
  suski: ["salad-grind", "feeble", "hurricane", "smith"],
  hurricane: ["salad-grind", "suski", "willy", "feeble"],
  willy: ["hurricane", "feeble", "smith", "salad-grind"],

  // Slides: boardslide ↔ lipslide ↔ bluntslide
  boardslide: ["lipslide", "tailslide", "noseslide", "50-50"],
  lipslide: ["boardslide", "bluntslide", "tailslide", "noseslide"],
  tailslide: ["noseslide", "boardslide", "lipslide", "5-0"],
  noseslide: ["tailslide", "boardslide", "lipslide", "nosegrind"],
  bluntslide: ["lipslide", "nollie-blunt", "tailslide", "noseslide"],
  "nollie-blunt": ["bluntslide", "noseslide", "nollie", "lipslide"],

  // Manuals
  manual: ["nose-manual", "5-0", "tailslide", "ollie"],
  "nose-manual": ["manual", "nosegrind", "noseslide", "ollie"],

  // Airs
  indy: ["melon", "mute", "stalefish", "method"],
  melon: ["indy", "mute", "method", "stalefish"],
  mute: ["indy", "melon", "method", "crail"],
  method: ["indy", "melon", "mute", "stalefish"],
  stalefish: ["indy", "method", "melon", "tailgrab"],
  tailgrab: ["stalefish", "method", "indy", "rocket-air"],

  // Base ollie
  ollie: ["nollie", "fakie-ollie", "pop-shove-it", "bs-180"],
  nollie: ["ollie", "fakie-ollie", "nollie-blunt", "switch-ollie"],
  "fakie-ollie": ["ollie", "nollie", "half-cab", "switch-ollie"],
  "switch-ollie": ["ollie", "nollie", "fakie-ollie", "switch-kickflip"],
};

/**
 * Get confusable tricks for WTT option generation.
 * Returns up to `count` confusable trick IDs.
 */
export function getConfusableTricks(trickId: string, count: number = 2): string[] {
  const confusables = TRICK_CONFUSION_MAP[trickId] ?? [];
  return confusables.slice(0, count);
}

/**
 * Generate random distractor from the same category.
 * Used as the 4th option when confusables don't fill all slots.
 */
export function getRandomDistractor(trickId: string, exclude: Set<string>): string | null {
  const trick = trickById(trickId);
  if (!trick) return null;

  const sameCategoryTricks = TRICKS.filter(
    (t) => t.category === trick.category && !exclude.has(t.id) && t.id !== trickId,
  );

  if (sameCategoryTricks.length === 0) return null;
  return sameCategoryTricks[Math.floor(Math.random() * sameCategoryTricks.length)].id;
}

/**
 * Rows for the picker. An empty query leads with recent, then popular,
 * then the rest grouped by category so the common tricks are one tap away.
 * A query is a flat list with recent and popular matches first.
 */
export function buildTrickPickerRows(query: string, recentIds: readonly string[]): TrickPickerRow[] {
  const q = query.trim().toLowerCase();
  const recentSet = new Set(recentIds);
  const recentTricks = recentIds
    .map((id) => trickById(id))
    .filter((trick): trick is CatalogTrick => trick !== undefined);

  if (q) {
    const hits = TRICKS.filter((trick) => matchesQuery(trick, q));
    const rank = (trick: CatalogTrick): number => {
      const recentIndex = recentIds.indexOf(trick.id);
      if (recentIndex >= 0) return recentIndex;
      const popular = POPULAR_RANK.get(trick.id);
      return popular === undefined ? 1000 : 100 + popular;
    };
    hits.sort((a, b) => rank(a) - rank(b) || byName(a, b));
    return hits.map((trick) => ({ kind: "trick", id: trick.id, label: trick.name, trick }));
  }

  const rows: TrickPickerRow[] = [];
  if (recentTricks.length > 0) {
    rows.push({ kind: "header", id: "header-recent", label: "Recent" });
    for (const trick of recentTricks) {
      rows.push({ kind: "trick", id: `recent-${trick.id}`, label: trick.name, trick });
    }
  }

  const popular = POPULAR_TRICK_IDS.map((id) => trickById(id)).filter(
    (trick): trick is CatalogTrick => trick !== undefined && !recentSet.has(trick.id),
  );
  if (popular.length > 0) {
    rows.push({ kind: "header", id: "header-popular", label: "Popular" });
    for (const trick of popular) {
      rows.push({ kind: "trick", id: `popular-${trick.id}`, label: trick.name, trick });
    }
  }

  const shown = new Set<string>([...recentTricks.map((t) => t.id), ...popular.map((t) => t.id)]);
  for (const category of TRICK_CATALOG_CATEGORIES) {
    const tricks = TRICKS.filter((trick) => trick.category === category.id && !shown.has(trick.id)).sort(byName);
    if (tricks.length === 0) continue;
    rows.push({ kind: "header", id: `header-${category.id}`, label: category.label });
    for (const trick of tricks) {
      rows.push({ kind: "trick", id: trick.id, label: trick.name, trick });
    }
  }
  return rows;
}

const RECENT_KEY = "skatehubba.recentTrickIds";
const RECENT_CAP = 8;

interface RecentTrickStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readRecentTrickIds(storage: Pick<RecentTrickStorage, "getItem"> | null = safeStorage()): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is string => typeof id === "string" && trickById(id) !== undefined)
      .slice(0, RECENT_CAP);
  } catch {
    return [];
  }
}

export function rememberRecentTrick(trickId: string, storage: RecentTrickStorage | null = safeStorage()): void {
  if (!storage || trickById(trickId) === undefined) return;
  const next = [trickId, ...readRecentTrickIds(storage).filter((id) => id !== trickId)].slice(0, RECENT_CAP);
  try {
    storage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private mode and full disks are not worth surfacing. The picker still works.
  }
}

function safeStorage(): RecentTrickStorage | null {
  try {
    const storage = (globalThis as { localStorage?: RecentTrickStorage }).localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}
