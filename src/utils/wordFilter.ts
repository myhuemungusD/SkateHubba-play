/**
 * Content moderation word filter.
 *
 * Simple substring matching against a blocklist. Case-insensitive. No regex
 * to keep the check fast and the list maintainable. False positives (e.g.
 * "Scunthorpe problem") are acceptable — a blocked word means the user can
 * rephrase, not that they're silenced.
 *
 * The list is deliberately small and focused on unambiguous slurs and
 * harassment. Expand conservatively: every added word is another way for
 * legitimate messages to trip the filter.
 */

/**
 * MUST match containsBlockedWord() in firestore.rules exactly: the create rule
 * requires isHidden == containsBlockedWord(content), so any drift rejects
 * sends. wordFilter.test.ts parses the rules and enforces this.
 */
export const BLOCKED_WORDS = [
  // Slurs and harassment
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "tranny",
  "chink",
  "kike",
  "wetback",
  // Spam patterns
  "bitcoin",
  "crypto",
  "buy now",
  "click here",
  "free money",
  // Explicit sexual content
  "fuck you",
  "suck my",
  "eat shit",
  "kill yourself",
];

/**
 * Check if the content contains any blocked words.
 * Returns null if clean, or the first matched word if flagged.
 */
export function checkWordFilter(content: string): string | null {
  const lower = content.toLowerCase();
  for (const word of BLOCKED_WORDS) {
    if (lower.includes(word)) {
      return word;
    }
  }
  return null;
}

/**
 * True when the content passes the filter (no blocked words found).
 */
export function isContentClean(content: string): boolean {
  return checkWordFilter(content) === null;
}
