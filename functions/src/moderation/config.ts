/**
 * Thresholds for public-clip moderation. Change these constants to retune
 * the screener — they are not read from the client.
 */

/** Likelihood ranks from the Video Intelligence API. Higher is more explicit. */
export const LIKELIHOOD_RANK = {
  UNKNOWN: 0,
  VERY_UNLIKELY: 1,
  UNLIKELY: 2,
  POSSIBLE: 3,
  LIKELY: 4,
  VERY_LIKELY: 5,
} as const;

export type LikelihoodName = keyof typeof LIKELIHOOD_RANK;

/** LIKELY or VERY_LIKELY is a clear explicit hit and the clip is rejected. */
export const REJECT_MIN_RANK = LIKELIHOOD_RANK.LIKELY;

/** POSSIBLE is borderline and goes to a person. Below that is not explicit. */
export const REVIEW_MIN_RANK = LIKELIHOOD_RANK.POSSIBLE;

/**
 * Label descriptions that count as skateboarding. Matched case-insensitively
 * against the Video Intelligence entity description.
 */
export const SKATE_LABELS = ["skateboard", "skateboarding"] as const;

/** A skate label below this confidence does not count, and the clip is reviewed. */
export const MIN_SKATE_CONFIDENCE = 0.6;

/** Distinct eligible reporters required before a public clip is auto-hidden. */
export const AUTO_HIDE_REPORT_THRESHOLD = 3;

/** Accounts newer than this do not count toward auto-hide. */
export const MIN_REPORTER_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Report reasons that are about the clip. Player-conduct reasons (cheating,
 * spam, abuse) stay in the reports queue and do not hide the video.
 * `non_skate_content` and `inappropriate_video` are the original codes;
 * `not_skating` and `inappropriate` are the clip-facing names.
 */
export const CLIP_REPORT_REASONS = [
  "not_skating",
  "inappropriate",
  "non_skate_content",
  "inappropriate_video",
] as const;

/** Give up on Video Intelligence after this and send the clip to review. */
export const VIDEO_API_TIMEOUT_MS = 240_000;

/** Pause between polls of the long-running annotate operation. */
export const VIDEO_API_POLL_MS = 2_000;
