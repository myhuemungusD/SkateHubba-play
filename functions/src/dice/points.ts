/**
 * Hand points. The harder the hand, the more it is worth, so a match is a
 * race to a score rather than a count of rounds. No points are ever spent,
 * bought, or redeemed; they only decide who reaches the target first.
 *
 * C-Lo / 4-5-6 (the round winner scores their own hand):
 *   4-5-6 = 3 · trips = 2 · a point = 1
 *   In 4-5-6, a 1-2-3 hands the other player 1 point on the spot.
 * Craps (the shooter scores their hand):
 *   natural 7 or 11 on the come-out = 1 · point made = 2 · hard point (4 or 10) made = 3
 *   craps (2, 3, 12) or seven-out = 0
 * 10,000 uses its own scoring (see farkle.ts); a banked turn adds its total.
 */
import { cloResolve } from "./clo.js";

const CLO_POINTS = { fourFiveSix: 3, trips: 2, point: 1, bail: 1 } as const;
const CRAPS_POINTS = { natural: 1, made: 2, hard: 3 } as const;

/** Points a C-Lo hand earns when it wins the round. */
export function cloHandPoints(dice: readonly number[]): number {
  const result = cloResolve(dice);
  if (result.outcome === "win") return result.rank === 1000 ? CLO_POINTS.fourFiveSix : CLO_POINTS.trips;
  return CLO_POINTS.point;
}

/** Points a craps hand earns. `comeOut` is true when the hand ended on the come-out roll. */
export function crapsHandPoints(won: boolean, comeOut: boolean, point: number | null): number {
  if (!won) return 0;
  if (comeOut) return CRAPS_POINTS.natural;
  return point === 4 || point === 10 ? CRAPS_POINTS.hard : CRAPS_POINTS.made;
}
