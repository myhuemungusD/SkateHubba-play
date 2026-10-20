/**
 * Rep: a persistent Elo-style skill rating. It is not a currency: it can't
 * be spent, bought, transferred, or redeemed. It only moves when a rated
 * match ends (reaching the target, or a forfeit after play started).
 *
 * Standard Elo with K = 32. Beating a higher-rated skater moves you more
 * than beating a lower-rated one. Everyone starts at 1000 and nobody drops
 * below 100.
 */
export const REP_START = 1000;
export const REP_K = 32;
export const REP_FLOOR = 100;

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

export function repOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : REP_START;
}

/** Rep change for a decided match. The winner always gains at least 1. */
export function repSwing(winnerRep: number, loserRep: number): { winner: number; loser: number } {
  const gain = Math.max(1, Math.round(REP_K * (1 - expectedScore(winnerRep, loserRep))));
  const loserAfter = Math.max(REP_FLOOR, loserRep - gain);
  return { winner: gain, loser: loserAfter - loserRep };
}
