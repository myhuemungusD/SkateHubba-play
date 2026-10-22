/**
 * Shown when a game can't be opened for this account: the rules refused the
 * read (not a player or judge, or access was revoked) or the game is gone.
 * Shared by the open-game listener in GameContext and the push deep link
 * (useGameDeepLink) so both fall back to the lobby with the same words.
 */
export const GAME_ACCESS_DENIED_TOAST = {
  type: "error" as const,
  title: "You can't open that game",
  message: "You don't have access to it. Back to the lobby.",
};

/**
 * Shown when a push deep link couldn't load its game because the read never
 * got an answer (offline or Firestore unreachable). Neutral on purpose: the
 * user may well have access, and the link is kept and retried once the device
 * is back online (useGameDeepLink).
 */
export const GAME_LINK_LOAD_FAILED_TOAST = {
  type: "info" as const,
  title: "Couldn't open that game",
  message: "Check your connection. We'll open it when you're back online.",
};
