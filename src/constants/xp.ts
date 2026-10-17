/**
 * XP curve, the four earning numbers, and the 36 ribbon achievements.
 *
 * The Cloud Function cannot import this file (`functions/tsconfig.json`
 * compiles only `functions/src`). `functions/src/applyGameStats.ts` carries
 * the same integers. Tests pin level 2 = 24, level 10 = 1,944, and level
 * 50 = 57,624 in both places.
 */

export const MAX_LEVEL = 50;
export const DAILY_XP_CAP = 3000;
export const FINISH_XP = 50;
export const WIN_XP = 50;
export const LAND_XP = 10;
export const CALL_XP = 10;
export const ACCOUNT_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** 1st game vs this person today, then half, quarter, then nothing. */
export const PAIR_MULTIPLIERS = [1, 0.5, 0.25, 0] as const;

export type AchievementTier = "bronze" | "silver" | "gold";

export interface AchievementDef {
  id: string;
  family: string;
  tier: AchievementTier;
  /** Tile label. Locked tiles show this, not question marks. */
  shortName: string;
  /** Screen-reader requirement. Also the achievement doc `reason`. */
  requirement: string;
  counter: XpCounter;
  threshold: number;
}

export type XpCounter =
  | "gamesPlayed"
  | "wins"
  | "bestWinStreak"
  | "tricksLanded"
  | "cleanWins"
  | "comebackWins"
  | "turnsJudged"
  | "disputeVotesCast"
  | "uniqueOpponents"
  | "spotsPlayed"
  | "gamesAtMySpots"
  | "clipsPosted";

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  def("games", "bronze", "games_10", "10 games", "Finish 10 games.", "gamesPlayed", 10),
  def("games", "silver", "games_50", "50 games", "Finish 50 games.", "gamesPlayed", 50),
  def("games", "gold", "games_250", "250 games", "Finish 250 games.", "gamesPlayed", 250),
  def("wins", "bronze", "wins_10", "10 wins", "Win 10 games.", "wins", 10),
  def("wins", "silver", "wins_100", "100 wins", "Win 100 games.", "wins", 100),
  def("wins", "gold", "wins_500", "500 wins", "Win 500 games.", "wins", 500),
  def("streak", "bronze", "streak_3", "3 streak", "Win 3 games in a row.", "bestWinStreak", 3),
  def("streak", "silver", "streak_5", "5 streak", "Win 5 games in a row.", "bestWinStreak", 5),
  def("streak", "gold", "streak_10", "10 streak", "Win 10 games in a row.", "bestWinStreak", 10),
  def("lands", "bronze", "lands_50", "50 lands", "Land 50 tricks.", "tricksLanded", 50),
  def("lands", "silver", "lands_250", "250 lands", "Land 250 tricks.", "tricksLanded", 250),
  def("lands", "gold", "lands_1000", "1,000 lands", "Land 1,000 tricks.", "tricksLanded", 1000),
  def("shutout", "bronze", "shutout_1", "Shutout", "Win a game without taking a letter.", "cleanWins", 1),
  def("shutout", "silver", "shutout_10", "10 shutouts", "Win 10 games without taking a letter.", "cleanWins", 10),
  def("shutout", "gold", "shutout_25", "25 shutouts", "Win 25 games without taking a letter.", "cleanWins", 25),
  def("comeback", "bronze", "comeback_1", "Comeback", "Win after falling to S.K.A.T.", "comebackWins", 1),
  def("comeback", "silver", "comeback_5", "5 comebacks", "Win 5 games after falling to S.K.A.T.", "comebackWins", 5),
  def("comeback", "gold", "comeback_20", "20 comebacks", "Win 20 games after falling to S.K.A.T.", "comebackWins", 20),
  def("whistle", "bronze", "whistle_1", "Whistle", "Rule 1 turn.", "turnsJudged", 1),
  def("whistle", "silver", "whistle_25", "25 calls", "Rule 25 turns.", "turnsJudged", 25),
  def("whistle", "gold", "whistle_100", "100 calls", "Rule 100 turns.", "turnsJudged", 100),
  def("votes", "bronze", "votes_1", "1 vote", "Cast 1 vote that stood.", "disputeVotesCast", 1),
  def("votes", "silver", "votes_25", "25 votes", "Cast 25 votes that stood.", "disputeVotesCast", 25),
  def("votes", "gold", "votes_100", "100 votes", "Cast 100 votes that stood.", "disputeVotesCast", 100),
  def("opponents", "bronze", "opponents_5", "5 opponents", "Skate 5 different people.", "uniqueOpponents", 5),
  def("opponents", "silver", "opponents_25", "25 opponents", "Skate 25 different people.", "uniqueOpponents", 25),
  def("opponents", "gold", "opponents_100", "100 opponents", "Skate 100 different people.", "uniqueOpponents", 100),
  def("spots", "bronze", "spots_1", "1 spot", "Finish a game at 1 spot.", "spotsPlayed", 1),
  def("spots", "silver", "spots_5", "5 spots", "Finish a game at 5 spots.", "spotsPlayed", 5),
  def("spots", "gold", "spots_20", "20 spots", "Finish a game at 20 spots.", "spotsPlayed", 20),
  def("home spot", "bronze", "homespot_1", "Home spot", "Finish 1 game at a spot you created.", "gamesAtMySpots", 1),
  def(
    "home spot",
    "silver",
    "homespot_10",
    "10 home games",
    "Finish 10 games at a spot you created.",
    "gamesAtMySpots",
    10,
  ),
  def(
    "home spot",
    "gold",
    "homespot_50",
    "50 home games",
    "Finish 50 games at a spot you created.",
    "gamesAtMySpots",
    50,
  ),
  def("clips", "bronze", "clips_1", "1 clip", "Post 1 clip.", "clipsPosted", 1),
  def("clips", "silver", "clips_10", "10 clips", "Post 10 clips.", "clipsPosted", 10),
  def("clips", "gold", "clips_50", "50 clips", "Post 50 clips.", "clipsPosted", 50),
];

export const BRONZE_ACHIEVEMENTS: readonly AchievementDef[] = ACHIEVEMENTS.filter((a) => a.tier === "bronze");

const FAMILY_ORDER = [
  "games",
  "wins",
  "streak",
  "lands",
  "shutout",
  "comeback",
  "whistle",
  "votes",
  "opponents",
  "spots",
  "home spot",
  "clips",
] as const;

export function achievementFamilies(): { family: string; tiers: AchievementDef[] }[] {
  return FAMILY_ORDER.map((family) => ({
    family,
    tiers: ACHIEVEMENTS.filter((a) => a.family === family),
  }));
}

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** Total XP required to be `level`. Level 1 is 0. Past 50 stays at the level-50 total. */
export function xpToReach(level: number): number {
  if (!Number.isFinite(level) || level <= 1) return 0;
  const steps = Math.min(Math.floor(level), MAX_LEVEL) - 1;
  return 24 * steps * steps;
}

/** Highest level whose threshold is still <= xp. Clamped to 1..50. Absent xp is level 1. */
export function levelForXp(xp: number): number {
  const safe = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  let level = 1;
  for (let steps = 1; steps < MAX_LEVEL; steps += 1) {
    if (24 * steps * steps <= safe) level = steps + 1;
    else break;
  }
  return level;
}

export interface XpProgress {
  level: number;
  /** Lifetime XP, never negative. */
  xp: number;
  /** XP required for the next level. At 50 this equals the level-50 total. */
  next: number;
  /** 0..1 fill of the current level. Full at level 50. */
  fraction: number;
  /** `140 / 216 XP`, or `Level 50` at the cap. */
  label: string;
}

export function xpProgress(rawXp: number | undefined): XpProgress {
  const xp = typeof rawXp === "number" && Number.isFinite(rawXp) && rawXp > 0 ? Math.floor(rawXp) : 0;
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) {
    const top = xpToReach(MAX_LEVEL);
    return { level: MAX_LEVEL, xp, next: top, fraction: 1, label: "Level 50" };
  }
  const floor = xpToReach(level);
  const next = xpToReach(level + 1);
  const span = next - floor;
  const fraction = span <= 0 ? 0 : Math.min(1, Math.max(0, (xp - floor) / span));
  return { level, xp, next, fraction, label: `${xp} / ${next} XP` };
}

/** Prior games against this pair on this UTC day. 4th and after pay 0. */
export function pairMultiplier(priorCount: number): number {
  const index = Number.isFinite(priorCount) && priorCount > 0 ? Math.min(3, Math.floor(priorCount)) : 0;
  return PAIR_MULTIPLIERS[index];
}

/** Floor after the pair multiplier. Halves round down. */
export function scaleXp(amount: number, multiplier: number): number {
  if (amount <= 0 || multiplier <= 0) return 0;
  return Math.floor(amount * multiplier);
}

/** How much of `award` still fits under the 3,000 daily cap. */
export function capXp(xpToday: number, award: number): number {
  if (award <= 0) return 0;
  const used = Number.isFinite(xpToday) && xpToday > 0 ? xpToday : 0;
  const room = Math.max(0, DAILY_XP_CAP - used);
  return Math.min(award, room);
}

export function utcDayFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Finish + optional win + lands, before the pair multiplier and the daily cap.
 * An empty forfeit and a pair of accounts younger than a day pay 0.
 * A forfeit after real skating pays the finish and the lands, not the win.
 */
export function playXpBeforeScale(input: {
  status: "complete" | "forfeit";
  emptyForfeit: boolean;
  accountsOldEnough: boolean;
  isWinner: boolean;
  lands: number;
}): number {
  if (input.emptyForfeit || !input.accountsOldEnough) return 0;
  const win = input.status === "complete" && input.isWinner ? WIN_XP : 0;
  const lands = input.lands > 0 ? input.lands * LAND_XP : 0;
  return FINISH_XP + win + lands;
}

/** 10 per ruled turn, or per vote still present when a dispute closes. Empty forfeits pay 0. */
export function callXp(count: number, emptyForfeit: boolean): number {
  if (emptyForfeit || count <= 0) return 0;
  return Math.floor(count) * CALL_XP;
}

function def(
  family: string,
  tier: AchievementTier,
  id: string,
  shortName: string,
  requirement: string,
  counter: XpCounter,
  threshold: number,
): AchievementDef {
  return { id, family, tier, shortName, requirement, counter, threshold };
}
