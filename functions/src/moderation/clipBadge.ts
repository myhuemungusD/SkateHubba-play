/**
 * How clipsPosted should move when a user clip's moderation changes.
 *
 * Only an approved clip counts toward clips_1 / clips_10 / clips_50. The
 * flag on the clip makes the move idempotent: approving twice does not add
 * two, and hiding an uncounted clip does not subtract.
 */
export function clipBadgeDelta(
  current: { source?: unknown; badgeCounted?: unknown },
  nextModeration: unknown,
): -1 | 0 | 1 {
  if (current.source !== "user") return 0;
  const counted = current.badgeCounted === true;
  if (nextModeration === "approved") return counted ? 0 : 1;
  if (counted && (nextModeration === "rejected" || nextModeration === "removed" || nextModeration === "review")) {
    return -1;
  }
  return 0;
}

export function nextClipsPosted(prior: unknown, delta: -1 | 0 | 1): number {
  const current = typeof prior === "number" && Number.isFinite(prior) && prior > 0 ? Math.floor(prior) : 0;
  return Math.max(0, current + delta);
}
