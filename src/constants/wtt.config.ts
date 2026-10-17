/**
 * What's That Trick server configuration.
 * Gold-seed verified pros and WTT processing parameters.
 */

/**
 * Verified pros whose labels seed the gold-standard training set.
 * Bryan and Mike are gold-seed pros. Jason is a tester only (not gold).
 */
export const WTT_GOLD_PROS = [
  "pHQL4mZGo7gNo3OJ86dmCRe3vai1", // Bryan
  "v5quZlBLijQYsQhwDqqmRkw6uzR2", // Mike
];

/**
 * Testers who can submit reviews but don't contribute to gold standard.
 */
export const WTT_TESTERS = [
  "DVpY1kJYXsYEJN8j3jr3r0wITl72", // Jason
];

/**
 * Consensus threshold: retire an item after this percentage agreement at 5+ votes.
 */
export const WTT_CONSENSUS_THRESHOLD = 0.85;

/**
 * Minimum votes required before checking consensus for retirement.
 */
export const WTT_MIN_VOTES_FOR_RETIREMENT = 5;

/**
 * Daily vote limit per user to prevent spam/gaming.
 */
export const WTT_DAILY_VOTE_LIMIT = 20;

/**
 * Daily vote streak target (for XP/achievements).
 */
export const WTT_DAILY_STREAK_TARGET = 3;

/**
 * XP awarded per correctly answered quiz item (compared against gold standard).
 */
export const WTT_XP_PER_CORRECT = 5;

/**
 * Maximum XP that can be earned per day from WTT to prevent grinding.
 */
export const WTT_MAX_DAILY_XP = 100;

/**
 * Feature flag: WTT processing enabled on server.
 * Set to false to disable all server-side WTT functions.
 */
export const WTT_ENABLED = process.env.WTT_ENABLED === "true";
