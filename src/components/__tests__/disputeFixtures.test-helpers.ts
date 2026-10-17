import type { Dispute } from "../../types/dispute";

const STORAGE_HOST = "https://firebasestorage.googleapis.com/v0/b/x/o";

/**
 * One open dispute in the shape both the lane spec and the vertical feed
 * spec render. Overrides cover the closed, unvotable, and bad-URL cases.
 */
export function makeDispute(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: "g1_3",
    gameId: "g1",
    turnNumber: 3,
    trickName: "Switch Heel",
    setterUid: "u1",
    setterUsername: "alice",
    matcherUid: "u2",
    matcherUsername: "bob",
    setVideoUrl: `${STORAGE_HOST}/set.webm?alt=media`,
    matchVideoUrl: `${STORAGE_HOST}/match.webm?alt=media`,
    spotId: null,
    createdAt: null,
    status: "open",
    moderationStatus: "active",
    landVotes: 2,
    bailVotes: 1,
    ...overrides,
  };
}
