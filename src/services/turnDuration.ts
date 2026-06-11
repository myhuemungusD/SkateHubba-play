/**
 * Turn-duration constant, extracted into a Firebase-free module so the
 * SDK-agnostic forfeit decision helper (`turnForfeit.shared.ts`) can import it
 * without pulling in the Firebase web SDK. `games.turns.ts` re-exports it so
 * existing `import { TURN_DURATION_MS } from "./games.turns"` callers are
 * unaffected.
 */

/** How long a player has to act on their turn before it can be forfeited. */
export const TURN_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
