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
