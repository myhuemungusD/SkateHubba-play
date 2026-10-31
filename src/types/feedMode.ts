/**
 * Feed mode types for the clips feed.
 * One feed, four modes: Scroll, Name It, Vote, Judge.
 */

export type FeedMode = "scroll" | "name-it" | "vote" | "judge";

export const FEED_MODE_LABELS: Record<FeedMode, string> = {
  scroll: "Scroll",
  "name-it": "Name It",
  vote: "Vote",
  judge: "Judge",
};
