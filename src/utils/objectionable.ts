/**
 * App Store Guideline 1.2 (user-generated content) requires "a method for
 * filtering objectionable material from being posted". Clip video screening
 * lives server-side (flagged); this is the text half for comments and
 * usernames.
 *
 * Deliberately narrow: slurs and hate terms, not everyday cursing. Skaters
 * swear, and a filter that blocks "sick f***ing kickflip" would feel broken.
 * Matching folds case and common look-alike swaps (0→o, 1→i, $→s, ...), so
 * "n1gg3r" is caught, and usernames are checked as a run of letters with the
 * underscores removed.
 */
const BLOCKED_TERMS = [
  "nigger",
  "nigga",
  "faggot",
  "fag",
  "retard",
  "tranny",
  "chink",
  "spic",
  "kike",
  "wetback",
  "gook",
  "coon",
  "dyke",
  "beaner",
  "raghead",
  "towelhead",
  "kys",
  "killyourself",
  "pedo",
  "nazi",
  "hitler",
];

// Long enough that a substring hit inside a username is never innocent.
const USERNAME_SUBSTRING_TERMS = BLOCKED_TERMS.filter((t) => t.length >= 5);

const LOOKALIKES: Record<string, string> = {
  "0": "o",
  "1": "i",
  "!": "i",
  "3": "e",
  "4": "a",
  "@": "a",
  "5": "s",
  $: "s",
  "7": "t",
};

function fold(text: string): string {
  let folded = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  // Every swap maps to a plain letter, never to another look-alike, so the
  // order of replacements cannot chain.
  for (const [lookalike, letter] of Object.entries(LOOKALIKES)) folded = folded.replaceAll(lookalike, letter);
  return folded;
}

/** True when free text (a comment) contains a blocked term as a word. */
export function containsObjectionableText(text: string): boolean {
  const words = fold(text)
    .split(/[^a-z]+/)
    .filter(Boolean);
  const joined = words.join("");
  if (words.some((w) => BLOCKED_TERMS.includes(w) || BLOCKED_TERMS.includes(w.replace(/s$/, "")))) return true;
  // "k y s" / "n.i.g.g.e.r": letters split up to dodge the word check.
  if (words.every((w) => w.length === 1) && words.length >= 3) {
    return BLOCKED_TERMS.some((t) => joined.includes(t));
  }
  return false;
}

/** True when a username contains a blocked term anywhere. */
export function isObjectionableUsername(username: string): boolean {
  const letters = fold(username).replace(/[^a-z]/g, "");
  if (BLOCKED_TERMS.includes(letters)) return true;
  return USERNAME_SUBSTRING_TERMS.some((t) => letters.includes(t));
}

export const OBJECTIONABLE_COMMENT_MESSAGE = "That comment has language we don't allow. Please edit it and try again.";
export const OBJECTIONABLE_TEXT_MESSAGE = "That has language we don't allow. Please edit it and try again.";
export const OBJECTIONABLE_USERNAME_MESSAGE = "That username isn't allowed. Please pick another.";
