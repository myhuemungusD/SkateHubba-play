import type { ClipDoc } from "../../services/clips";

/**
 * Shared clip-document fixtures.
 *
 * Two specs describe the same `ClipDoc` shape from opposite sides: the feed
 * spec (`ClipsFeed.test.tsx`) renders a tile from it, and the comments-sheet
 * spec (`ClipsFeed/__tests__/ClipComments.test.tsx`) only needs a clip to
 * hang a thread on. Both previously spelled the full 14-field document out
 * inline, so a field added to `ClipDoc` had to be added in two places and a
 * drift between them would go unnoticed.
 *
 * Filename follows the project `*.test-helpers.ts` convention: outside
 * Vitest's `*.test.{ts,tsx}` include glob, excluded from coverage, and skipped
 * by the test-duplication gate.
 */

/**
 * A game-sourced clip in its ordinary state: active moderation, no votes, no
 * spot tag, and a null `createdAt` so a spec that cares about relative-time
 * rendering has to say so explicitly.
 */
export function makeGameClip(overrides: Partial<ClipDoc> = {}): ClipDoc {
  return {
    id: "g1_2_set",
    source: "game",
    gameId: "g1",
    turnNumber: 2,
    role: "set",
    playerUid: "p1",
    playerUsername: "alice",
    trickName: "Kickflip",
    videoUrl: "https://firebasestorage.googleapis.com/v0/b/x/o/games%2Fg1%2Fturn-2%2Fset.webm?alt=media",
    spotId: null,
    createdAt: null,
    moderationStatus: "active",
    upvoteCount: 0,
    downvoteCount: 0,
    ...overrides,
  } as ClipDoc;
}
