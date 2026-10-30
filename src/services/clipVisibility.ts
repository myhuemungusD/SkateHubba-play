/**
 * Whether a clip or dispute may appear in a public feed.
 *
 * Legacy docs have no `moderation` field and stay visible while their
 * moderationStatus is active (or missing, which the feed query already
 * treats as active). A workflow value other than `approved` is hidden,
 * including a pending upload and a clip sent back for review.
 */
const WORKFLOW = new Set(["pending", "approved", "review", "rejected", "removed"]);

export function isPubliclyApproved(data: { moderationStatus?: unknown; moderation?: unknown }): boolean {
  if (data.moderationStatus === "hidden" || data.moderationStatus === "pending") return false;
  const moderation = data.moderation;
  if (typeof moderation !== "string" || moderation.length === 0) return true;
  if (!WORKFLOW.has(moderation)) return false;
  return moderation === "approved";
}

/**
 * Whether a clip is a user post, the only kind the public surfaces show
 * (the feed, its Spotlight cards, Pro Picks, and profile reels and spots).
 *
 * Game clips (`source: "game"`) are turn videos from a game. They stay in
 * the game and dispute screens, where both players and the dispute jury
 * need them, but the player never chose to post them publicly.
 *
 * A clip with no `source` is a legacy doc. Every clip written before user
 * uploads existed was a game clip, user uploads always write
 * `source: "user"`, and the mapper already reads a missing source as
 * "game" (clips.mappers.ts). So a missing source is treated as a game clip
 * and kept off the public surfaces. Only the exact string "user" passes.
 */
export function isUserPostedClip(data: { source?: unknown } | null | undefined): boolean {
  return data?.source === "user";
}
