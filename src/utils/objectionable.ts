/**
 * App Store Guideline 1.2 (user-generated content) requires "a method for
 * filtering objectionable material from being posted". Clip video screening
 * lives server-side (flagged); this is the text half for comments and
 * usernames.
 *
 * Deliberately narrow: slurs and hate terms, not everyday cursing. Skaters
 * swear, and a filter that blocks "sick f***ing kickflip" would feel broken.
 * Matching folds case and common look-alike swaps (0→o, 1→i, $→s, ...), so
 * "n1gg3r" and "n1663r" are caught, and usernames are checked as a run of letters with the
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

// Self-harm taunts ("kill yourself") are two or three words, so the one-word
// check above can't see them. Matched on whole adjacent words only: joining
// the text into one string first would block "skill yourself".
const SELF_HARM_VERBS = ["kill", "neck", "hang", "unalive"];
const REFLEXIVES = ["yourself", "yourselves", "urself", "urselves", "yoself", "yoselves", "uself"];
// Run-together spellings ("killurself") are single words, so they join the
// blocklist (and, at 5+ letters, the username substring check).
for (const verb of SELF_HARM_VERBS) {
  for (const reflexive of REFLEXIVES) {
    const term = verb + reflexive;
    if (!BLOCKED_TERMS.includes(term)) BLOCKED_TERMS.push(term);
  }
}

function hasSelfHarmPhrase(words: string[]): boolean {
  for (let i = 0; i < words.length - 1; i++) {
    if (!SELF_HARM_VERBS.includes(words[i])) continue;
    // "kill yourself" and the split forms "kill your self" / "kill ur self".
    if (REFLEXIVES.includes(words[i + 1])) return true;
    if (i + 2 < words.length && REFLEXIVES.includes(words[i + 1] + words[i + 2])) return true;
  }
  return false;
}

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
  "6": "g",
  "7": "t",
  "8": "b",
  "9": "g",
};

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[01!3-9@$]/g, (c) => LOOKALIKES[c] ?? c);
}

/** True when free text (a comment) contains a blocked term as a word. */
export function containsObjectionableText(text: string): boolean {
  const words = fold(text)
    .split(/[^a-z]+/)
    .filter(Boolean);
  const joined = words.join("");
  if (words.some((w) => BLOCKED_TERMS.includes(w) || BLOCKED_TERMS.includes(w.replace(/s$/, "")))) return true;
  if (hasSelfHarmPhrase(words)) return true;
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
