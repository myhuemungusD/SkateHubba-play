/**
 * Shared player-stat display rules.
 *
 * The win-rate floor exists because a percentage computed over one or two
 * games is noise presented as a fact: a player at 1-0 reads "100%" and
 * outranks a 40-15 veteran on any rate-based sort. Both the profile grid and
 * the leaderboard consume the helpers below so the two surfaces can never
 * disagree about who is "rated".
 *
 * No Firebase imports here — pure display logic, safe for services and UI.
 */

/**
 * Completed games a player needs before their win rate is shown as a number
 * (and before they are ranked by rate on the leaderboard). Five is low enough
 * that an active player clears it in a session or two, high enough that a
 * single lucky game can't mint a 100% headline.
 */
export const MIN_RATED_GAMES = 5;

/** Total completed games backing a rate. Legacy docs missing either counter read as 0. */
export function totalGames(wins: number | undefined, losses: number | undefined): number {
  return (wins ?? 0) + (losses ?? 0);
}

/**
 * Win rate as a whole percentage, or `null` when the player has not yet played
 * {@link MIN_RATED_GAMES}. Callers render `null` as a neutral placeholder
 * rather than substituting 0 — "not enough games" and "never won" are
 * different claims and must not look alike.
 */
export function ratedWinRate(wins: number | undefined, losses: number | undefined): number | null {
  const total = totalGames(wins, losses);
  if (total < MIN_RATED_GAMES) return null;
  return Math.round(((wins ?? 0) / total) * 100);
}

/** A record rendered as two numbers, wins / games, plus the spoken form. */
export interface FormattedRecord {
  /** Visible text, e.g. "2 / 4". No W/L letters: people can do the math. */
  text: string;
  /** Screen-reader text, e.g. "2 wins out of 4 games". */
  label: string;
}

const count = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/**
 * The one record format used app-wide (profile opponents, Home's Recently
 * played, leaderboard, Pro and dice records, lobby summary): wins over games.
 * Missing or bad counters read as 0, and wins never exceed games.
 */
export function formatRecord(wins: number | undefined, games: number | undefined): FormattedRecord {
  const g = count(games);
  const w = Math.min(count(wins), g);
  return {
    text: `${w} / ${g}`,
    label: `${w} ${w === 1 ? "win" : "wins"} out of ${g} ${g === 1 ? "game" : "games"}`,
  };
}
