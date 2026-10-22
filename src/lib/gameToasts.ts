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
