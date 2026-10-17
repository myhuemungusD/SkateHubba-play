/**
 * Closet earn track integration hook — awards Hubba Bucks when games complete.
 * Calls the Cloud Function (when deployed) to credit the player's wallet.
 *
 * Usage: call `useClosetEarnTrack()` on the game-over screen or in a global effect.
 */
import { useEffect, useRef } from "react";
import { httpsCallable } from "firebase/functions";
import { requireFunctions } from "../firebase";
import { logger } from "../services/logger";
import { parseFirebaseError } from "../utils/helpers";
import { trackEvent } from "../services/analytics";
import { isClosetEnabled } from "../lib/featureFlags";

const EARN_RATES = {
  gameComplete: 35, // Bucks per S.K.A.T.E. game completed (tuned to 66% spend ratio)
  achievementGrant: 75, // Per achievement badge earned
  streakBonus: 50, // Weekly streak milestone
};

interface AwardEarnParams {
  uid: string;
  event: "game_complete" | "achievement_grant" | "streak_bonus" | "milestone";
  amountBucks: number;
  metadata?: Record<string, unknown>;
}

/**
 * Award Hubba Bucks to a user for completing a game.
 * Throws on failure (offline, permission-denied, etc.).
 */
async function awardGameCompleteBucks(uid: string, gameId: string): Promise<void> {
  if (!isClosetEnabled()) return;

  try {
    const fns = await requireFunctions();
    const callable = httpsCallable<AwardEarnParams, { newBalance: number }>(fns, "awardEarn");
    await callable({
      uid,
      event: "game_complete",
      amountBucks: EARN_RATES.gameComplete,
      metadata: { gameId },
    });
    trackEvent("closet_earn_game_complete", { uid, gameId, amountBucks: EARN_RATES.gameComplete });
  } catch (err) {
    logger.warn("closet_earn_game_complete_failed", { uid, gameId, error: parseFirebaseError(err) });
    throw err;
  }
}

/**
 * Hook to integrate closet earn track into the app.
 * Call this with the current user's uid and the completed game's id.
 *
 * Example usage on GameOverScreen:
 *
 * ```tsx
 * const { user } = useAuth();
 * useClosetEarnTrack(user?.uid, game.status === 'complete' ? game.id : null);
 * ```
 */
export function useClosetEarnTrack(uid: string | undefined, completedGameId: string | null) {
  const awardedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!uid || !completedGameId || !isClosetEnabled()) return;
    if (awardedRef.current.has(completedGameId)) return;

    awardedRef.current.add(completedGameId);

    void (async () => {
      try {
        await awardGameCompleteBucks(uid, completedGameId);
      } catch (err) {
        // Fail-soft: the game completed successfully, the earn is a bonus
        logger.warn("closet_earn_track_failed", { uid, completedGameId, error: parseFirebaseError(err) });
      }
    })();
  }, [uid, completedGameId]);
}
