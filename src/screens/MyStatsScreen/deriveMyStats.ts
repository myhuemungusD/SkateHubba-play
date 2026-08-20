import type { UserProfile } from "../../services/users";

/**
 * Owner-only analytics derived from the signed-in user's public profile doc.
 *
 * Every input counter is server-written and optional — a profile created
 * before a given counter shipped simply lacks the field, so all of them read
 * as 0 here. Rates are `null` rather than 0 when their denominator is empty:
 * "no games yet" and "0%" are different claims and must not look alike (the
 * same rule `ratedWinRate` follows on the public profile).
 */

export interface MyStats {
  gamesPlayed: number;
  /** Games abandoned — losses recorded as a forfeit. */
  gamesAbandoned: number;
  /**
   * Humanized average wall-clock game length, or null when no game has
   * contributed a duration yet.
   */
  avgGameLength: string | null;
  /** Average letters taken per game to one decimal, or null with no games. */
  avgLettersTaken: string | null;
  /** Landed / attempted as a whole percent, or null with no attempts. */
  trickConsistency: number | null;
  tricksLanded: number;
  tricksFailed: number;
  cleanWins: number;
  comebackWins: number;
  gamesJudged: number;
  turnsJudged: number;
  lettersGiven: number;
  lettersTaken: number;
}

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/**
 * Render a duration as the two largest non-zero units. SKATE games are async
 * with 24-hour turn timers, so a "game length" is routinely days — minutes
 * alone would print a five-digit number nobody can read at a glance.
 * Sub-minute durations round to "<1m" rather than "0m".
 */
export function humanizeDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < MS_PER_MINUTE) return "<1m";
  const totalMinutes = Math.floor(ms / MS_PER_MINUTE);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  const totalHours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const hours = totalHours % HOURS_PER_DAY;
  const days = Math.floor(totalHours / HOURS_PER_DAY);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (totalHours > 0) return minutes > 0 ? `${totalHours}h ${minutes}m` : `${totalHours}h`;
  return `${totalMinutes}m`;
}

/** Completed games, preferring the counter and falling back for legacy docs. */
function playedGames(profile: UserProfile): number {
  return profile.gamesPlayed ?? (profile.wins ?? 0) + (profile.losses ?? 0);
}

export function deriveMyStats(profile: UserProfile): MyStats {
  const gamesPlayed = playedGames(profile);
  const tricksLanded = profile.tricksLanded ?? 0;
  const tricksFailed = profile.tricksFailed ?? 0;
  const attempts = tricksLanded + tricksFailed;
  const lettersTaken = profile.lettersTaken ?? 0;
  const totalDurationMs = profile.totalGameDurationMs ?? 0;
  // Average over the games that actually contributed a duration, not every
  // game played: `totalGameDurationMs` and `gamesWithDuration` are incremented
  // together, so games closed out before the counters shipped are excluded
  // from both. Dividing by `gamesPlayed` would blend those zero-duration games
  // in and understate the average.
  const gamesWithDuration = profile.gamesWithDuration ?? 0;

  return {
    gamesPlayed,
    gamesAbandoned: profile.forfeitLosses ?? 0,
    avgGameLength: gamesWithDuration > 0 ? humanizeDuration(totalDurationMs / gamesWithDuration) : null,
    avgLettersTaken: gamesPlayed > 0 ? (lettersTaken / gamesPlayed).toFixed(1) : null,
    trickConsistency: attempts > 0 ? Math.round((tricksLanded / attempts) * 100) : null,
    tricksLanded,
    tricksFailed,
    cleanWins: profile.cleanWins ?? 0,
    comebackWins: profile.comebackWins ?? 0,
    gamesJudged: profile.gamesJudged ?? 0,
    turnsJudged: profile.turnsJudged ?? 0,
    lettersGiven: profile.lettersGiven ?? 0,
    lettersTaken,
  };
}
