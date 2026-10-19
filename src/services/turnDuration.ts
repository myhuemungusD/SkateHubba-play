/**
 * Turn-duration constants and helpers, kept in a Firebase-free module so the
 * SDK-agnostic decision helpers (`turnForfeit.shared.ts`,
 * `dispute.resolution.shared.ts`) can import them without pulling in the
 * Firebase web SDK. `games.turns.ts` re-exports TURN_DURATION_MS so existing
 * `import { TURN_DURATION_MS } from "./games.turns"` callers are unaffected.
 *
 * Turn length (VITE_FEATURE_TURN_LENGTH): the challenger can pick how long each
 * turn lasts when the game is created. The choice is stored on the game as
 * `turnLengthHours` (24, 72 or 168) and is immutable. Games without the field
 * (every legacy game, and every game made while the flag is off) play 24h
 * turns exactly as before. firestore.rules validates the same three values and
 * checks every turn clock against the game's own length.
 */

const HOUR_MS = 60 * 60 * 1000;

/** How long a player has to act on their turn before it can be forfeited (default game). */
export const TURN_DURATION_MS = 24 * HOUR_MS; // 24 hours

/** The turn lengths a challenger can choose, in hours. Mirrors firestore.rules. */
export const TURN_LENGTH_OPTIONS = [24, 72, 168] as const;

export type TurnLengthHours = (typeof TURN_LENGTH_OPTIONS)[number];

/** Turn length of every game that does not carry the field. */
export const DEFAULT_TURN_LENGTH_HOURS: TurnLengthHours = 24;

/** True when `value` is one of the allowed turn lengths. */
export function isTurnLengthHours(value: unknown): value is TurnLengthHours {
  return TURN_LENGTH_OPTIONS.includes(value as TurnLengthHours);
}

/** The game's turn length in hours. Missing or unknown values read as 24. */
export function turnLengthHoursOf(game: { turnLengthHours?: unknown } | null | undefined): TurnLengthHours {
  const raw = game?.turnLengthHours;
  return isTurnLengthHours(raw) ? raw : DEFAULT_TURN_LENGTH_HOURS;
}

/**
 * How long each turn (and the setter's accept/dispute window) lasts for this
 * game, in ms. 24h for any game without a valid `turnLengthHours`.
 */
export function turnDurationMsFor(game: { turnLengthHours?: unknown } | null | undefined): number {
  return turnLengthHoursOf(game) * HOUR_MS;
}

/** Short label for chips and invites: "24h turns", "3-day turns", "7-day turns". */
export function turnLengthLabel(hours: TurnLengthHours): string {
  return hours === 24 ? "24h turns" : `${hours / 24}-day turns`;
}
