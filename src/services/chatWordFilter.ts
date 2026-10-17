/**
 * Chat word filter — the client half of spot-chat AutoMod.
 *
 * Modeled on Discord AutoMod's keyword presets: terms are grouped into
 * categories, and only some categories auto-hide a message. Everyday skate
 * profanity ("that line was sick as fuck") is flagged but NOT hidden, the
 * same way Discord's "Severe Profanity" preset is opt-in. Slurs, sexual
 * content, and threats / self-harm incitement are hidden.
 *
 * Matching is token-based to avoid the Scunthorpe problem: "Niger",
 * "Scunthorpe", "spice", and "assassin" never match. Evasion handled:
 *  - case, diacritics ("fäg"), and zero-width characters
 *  - leetspeak ("f4gg0t", "$lut")
 *  - stretched letters ("fuuuuck"), for terms with no doubled letter
 *  - spaced or dotted letters ("f u c k", "k.y.s")
 *  - common suffixes ("-s", "-ed", "-ing", ...)
 *
 * firestore.rules carries a short regex of the worst terms
 * (chatBannedWordsRe). Anything it matches MUST be auto-hidden here,
 * otherwise the client would write `isHidden: false` and the rule would
 * reject the send. chatWordFilter.test.ts parses the rule and enforces it.
 */

export type BannedWordCategory = "slur" | "sexual" | "threat" | "profanity";

export interface WordFilterResult {
  /** No banned term of any category was found. */
  isClean: boolean;
  /** At least one match is in an auto-hide category. */
  shouldHide: boolean;
  /** Canonical banned terms that matched, deduplicated, in first-seen order. */
  matches: string[];
  /** Categories of the matches, deduplicated. */
  categories: BannedWordCategory[];
}

/** Categories that hide a message automatically. */
export const AUTO_HIDE_CATEGORIES: ReadonlySet<BannedWordCategory> = new Set<BannedWordCategory>([
  "slur",
  "sexual",
  "threat",
]);

/**
 * Single-token terms by category. Lowercase ASCII only. Keep terms whose
 * collapsed form is a real word out of here (e.g. "boob" → "bob").
 */
export const BANNED_TERMS: Readonly<Record<BannedWordCategory, readonly string[]>> = {
  slur: [
    "nigger",
    "nigga",
    "niggah",
    "faggot",
    "fag",
    "faggit",
    "dyke",
    "tranny",
    "shemale",
    "retard",
    "spic",
    "spick",
    "beaner",
    "wetback",
    "chink",
    "gook",
    "kike",
    "towelhead",
    "raghead",
    "jigaboo",
    "porchmonkey",
    "honky",
    "honkey",
    "paki",
  ],
  sexual: [
    "porn",
    "porno",
    "pornhub",
    "xvideos",
    "hentai",
    "blowjob",
    "handjob",
    "rimjob",
    "cumshot",
    "creampie",
    "gangbang",
    "bukkake",
    "dildo",
    "milf",
    "fellatio",
    "cunnilingus",
    "jizz",
    "orgasm",
    "masturbate",
    "masturbating",
    "pussy",
    "slut",
    "whore",
    "skank",
    "nudes",
  ],
  threat: ["kys", "unalive"],
  profanity: [
    "fuck",
    "fuk",
    "fck",
    "fuq",
    "motherfucker",
    "shit",
    "bullshit",
    "bitch",
    "bastard",
    "cunt",
    "twat",
    "wanker",
    "prick",
    "douche",
    "douchebag",
    "asshole",
    "arsehole",
    "dumbass",
    "jackass",
  ],
};

/** Multi-word phrases (space-separated tokens) by category. */
export const BANNED_PHRASES: Readonly<Partial<Record<BannedWordCategory, readonly string[]>>> = {
  threat: [
    "kill yourself",
    "kill urself",
    "kill your self",
    "kill ur self",
    "go kill yourself",
    "hope you die",
    "hope u die",
    "neck yourself",
    "rope yourself",
    "end yourself",
    "unalive yourself",
    "i will kill you",
    "im going to kill you",
  ],
  sexual: ["send nudes"],
};

/**
 * Suffixes accepted after a term. A superset of the rules regex suffix group.
 * No "es" or "y": they turn "spices", "spicy" and "tardy" into slur hits.
 */
export const TERM_SUFFIXES: readonly string[] = ["s", "ed", "er", "ers", "ing", "in", "z"];

const LEET_MAP: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  $: "s",
  "!": "i",
  "|": "i",
  "+": "t",
};

const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;
const NON_LETTER_RE = /[^a-z]+/;

interface TermEntry {
  term: string;
  category: BannedWordCategory;
}

function collapseRuns(value: string): string {
  return value.replace(/(.)\1+/g, "$1");
}

const EXACT_TERMS = new Map<string, TermEntry>();
/** Collapsed-form lookup, only for terms with no doubled letter. */
const COLLAPSED_TERMS = new Map<string, TermEntry>();

for (const category of Object.keys(BANNED_TERMS) as BannedWordCategory[]) {
  for (const term of BANNED_TERMS[category]) {
    const entry: TermEntry = { term, category };
    EXACT_TERMS.set(term, entry);
    if (collapseRuns(term) === term) COLLAPSED_TERMS.set(term, entry);
  }
}

function lookupStem(stem: string): TermEntry | undefined {
  return EXACT_TERMS.get(stem) ?? COLLAPSED_TERMS.get(collapseRuns(stem));
}

function matchToken(token: string): TermEntry | undefined {
  const direct = lookupStem(token);
  if (direct) return direct;
  for (const suffix of TERM_SUFFIXES) {
    if (token.length > suffix.length && token.endsWith(suffix)) {
      const hit = lookupStem(token.slice(0, -suffix.length));
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Plain tokenization: mirrors the rules regex (lowercase, split on non a-z). */
function plainTokens(text: string): string[] {
  return text.toLowerCase().split(NON_LETTER_RE).filter(Boolean);
}

/** Aggressive tokenization: strip diacritics and zero-width chars, undo leetspeak. */
function normalizedTokens(text: string): string[] {
  const deLeeted = text
    .normalize("NFKD")
    .replace(COMBINING_MARKS_RE, "")
    .replace(ZERO_WIDTH_RE, "")
    .toLowerCase()
    .replace(/[0-9@$!|+]/g, (ch) => LEET_MAP[ch] ?? ch);
  return deLeeted.split(NON_LETTER_RE).filter(Boolean);
}

/** Join runs of single-letter tokens: ["f","u","c","k"] → "fuck". */
function joinedSingles(tokens: readonly string[]): string[] {
  const joined: string[] = [];
  let run = "";
  for (const token of [...tokens, ""]) {
    if (token.length === 1) {
      run += token;
      continue;
    }
    if (run.length >= 3) joined.push(run);
    run = "";
  }
  return joined;
}

/**
 * Normalize text the way the filter sees it. Exported for the UI's
 * "why was this hidden" affordance and for tests.
 */
export function normalizeForFilter(text: string): string {
  return normalizedTokens(text).join(" ");
}

/** Check `text` against the banned-term lists. Pure; never throws. */
export function filterContent(text: string): WordFilterResult {
  const hits: TermEntry[] = [];
  const plain = plainTokens(text);
  const normalized = normalizedTokens(text);

  for (const token of [...plain, ...normalized, ...joinedSingles(normalized)]) {
    const hit = matchToken(token);
    if (hit) hits.push(hit);
  }

  for (const tokens of [plain, normalized]) {
    const haystack = ` ${tokens.join(" ")} `;
    for (const category of Object.keys(BANNED_PHRASES) as BannedWordCategory[]) {
      for (const phrase of BANNED_PHRASES[category] ?? []) {
        if (haystack.includes(` ${phrase} `)) hits.push({ term: phrase, category });
      }
    }
  }

  const matches = [...new Set(hits.map((h) => h.term))];
  const categories = [...new Set(hits.map((h) => h.category))];
  return {
    isClean: hits.length === 0,
    shouldHide: categories.some((c) => AUTO_HIDE_CATEGORIES.has(c)),
    matches,
    categories,
  };
}
