/**
 * Pure Roll Dice match engine: types, match lifecycle (challenge, accept,
 * decline, cancel, quit, timeout) and the end-of-match check. The per-game
 * roll rules live in play.ts.
 *
 * A match is a race to `target` points between two seats. Seat 0 is the
 * challenger. A new match starts `pending` until the opponent accepts.
 *
 * Fairness rule for the alternating games (craps, 10,000): the match is only
 * decided after both players have had the same number of hands. If the
 * challenger reaches the target first, the opponent still gets their hand.
 * A tie at or over the target plays another pair of hands.
 */
import { MODE_RULES, type DiceMode } from "./modes.js";

export const HISTORY_CAP = 40;
export const ROUNDS_CAP = 60;
export const TURN_DURATION_MS = 24 * 60 * 60 * 1000;
export const ROLL_COOLDOWN_MS = 700;
export const CREATE_COOLDOWN_MS = 10_000;
export const ACTIVE_GAME_CAP = 10;
export const NUDGE_COOLDOWN_MS = 60 * 60 * 1000;
export const REMINDER_LEAD_MS = 3 * 60 * 60 * 1000;

export type DiceStatus = "pending" | "active" | "complete" | "forfeit" | "declined" | "expired";
export type DiceEndReason = "target" | "quit" | "timeout" | "decline" | "cancel";

export interface TenState {
  /** Points set aside so far this turn (not yet banked). */
  turnScore: number;
  /** Face values set aside this turn. Six kept means hot dice: all six roll again. */
  kept: readonly number[];
  /** Dice on the table waiting for a keep choice. Empty at the start of a turn. */
  rolled: readonly number[];
}

export interface DiceMatch {
  mode: DiceMode;
  target: number;
  status: DiceStatus;
  /** Seat order. Index 0 is the challenger. */
  seats: readonly string[];
  current: number;
  round: number;
  scores: Readonly<Record<string, number>>;
  /** Rounds (C-Lo, 4-5-6) or scoring hands (craps, 10,000) won. */
  roundsWon: Readonly<Record<string, number>>;
  /** C-Lo / 4-5-6: settled dice for the current round, keyed by uid. */
  rolls: Readonly<Record<string, readonly number[]>>;
  /** Craps: the shooter's point, or null on the come-out. */
  point: number | null;
  ten: TenState;
  /** Completed hands per seat (craps, 10,000). */
  turns: Readonly<Record<string, number>>;
  rollCount: number;
  accepted: boolean;
  winner: string | null;
  endReason: DiceEndReason | null;
}

export const EMPTY_TEN: TenState = { turnScore: 0, kept: [], rolled: [] };

function zeroed(seats: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const uid of seats) out[uid] = 0;
  return out;
}

export function freshMatch(seats: readonly string[], mode: DiceMode, target: number): DiceMatch {
  return {
    mode,
    target,
    status: "pending",
    seats,
    current: 0,
    round: 1,
    scores: zeroed(seats),
    roundsWon: zeroed(seats),
    rolls: {},
    point: null,
    ten: EMPTY_TEN,
    turns: zeroed(seats),
    rollCount: 0,
    accepted: false,
    winner: null,
    endReason: null,
  };
}

/** True once the opponent accepted or anyone has rolled. Legacy matches had no accept step. */
export function matchHasStarted(state: DiceMatch): boolean {
  if (state.accepted || state.round > 1 || state.rollCount > 0) return true;
  if (Object.keys(state.rolls).length > 0) return true;
  return Object.values(state.scores).some((n) => n > 0);
}

export function assertActive(state: DiceMatch): void {
  if (state.status !== "active") throw new Error("NOT_IN_PROGRESS");
}

export function assertTurn(state: DiceMatch, uid: string): void {
  assertActive(state);
  if (!state.seats.includes(uid)) throw new Error("NOT_A_PLAYER");
  if (state.seats[state.current] !== uid) throw new Error("NOT_YOUR_TURN");
}

export function otherSeat(state: DiceMatch, uid: string): string {
  const other = state.seats.find((seat) => seat !== uid);
  if (!other) throw new Error("NO_OPPONENT");
  return other;
}

export function seatIndex(state: DiceMatch, uid: string): number {
  const idx = state.seats.indexOf(uid);
  if (idx < 0) throw new Error("NOT_A_PLAYER");
  return idx;
}

/**
 * Decide the match if it is over. Simultaneous games (C-Lo, 4-5-6) end the
 * moment a round winner reaches the target. Alternating games wait until
 * both seats have played the same number of hands.
 */
export function settleMatch(state: DiceMatch): DiceMatch {
  if (state.status !== "active") return state;
  const [a, b] = state.seats;
  if (!a || !b) throw new Error("NO_OPPONENT");
  if (MODE_RULES[state.mode].alternating && (state.turns[a] ?? 0) !== (state.turns[b] ?? 0)) return state;
  const sa = state.scores[a] ?? 0;
  const sb = state.scores[b] ?? 0;
  if (Math.max(sa, sb) < state.target || sa === sb) return state;
  return { ...state, status: "complete", winner: sa > sb ? a : b, endReason: "target" };
}

export function applyAccept(state: DiceMatch, uid: string): DiceMatch {
  if (state.status !== "pending") throw new Error("NOT_PENDING");
  if (uid !== state.seats[1]) throw new Error("NOT_ACCEPTABLE");
  return { ...state, status: "active", accepted: true, current: 0 };
}

export type TimeoutDecision = { action: "none" } | { action: "expired" } | { action: "forfeit"; winnerUid: string };

/**
 * Shared by the callable's claimTimeout action and the scheduled sweep so
 * the two paths cannot disagree. An unanswered challenge, or a match nobody
 * played in, expires with no stats. Any later expiry is a forfeit: the
 * player who was waiting wins.
 */
export function decideDiceTimeout(state: DiceMatch, nowMs: number, deadlineMs: number): TimeoutDecision {
  if (state.status !== "active" && state.status !== "pending") return { action: "none" };
  if (!(nowMs >= deadlineMs)) return { action: "none" };
  if (state.status === "pending" || !matchHasStarted(state)) return { action: "expired" };
  const actor = state.seats[state.current];
  if (!actor) throw new Error("NO_OPPONENT");
  return { action: "forfeit", winnerUid: otherSeat(state, actor) };
}

export function applyTimeout(state: DiceMatch, nowMs: number, deadlineMs: number): DiceMatch | null {
  const decision = decideDiceTimeout(state, nowMs, deadlineMs);
  if (decision.action === "none") return null;
  if (decision.action === "expired") {
    return { ...state, status: "expired", winner: null, endReason: "timeout" };
  }
  return { ...state, status: "forfeit", winner: decision.winnerUid, endReason: "timeout" };
}

/**
 * Either player can leave. Before play starts, the challenger leaving
 * cancels the challenge and the opponent leaving declines it; neither moves
 * a record. After play has started, leaving forfeits to the player who stayed.
 */
export function applyQuit(state: DiceMatch, uid: string): DiceMatch {
  if (state.status !== "active" && state.status !== "pending") throw new Error("NOT_IN_PROGRESS");
  if (!state.seats.includes(uid)) throw new Error("NOT_A_PLAYER");
  if (state.status === "pending" || !matchHasStarted(state)) {
    if (uid === state.seats[0]) return { ...state, status: "expired", winner: null, endReason: "cancel" };
    return { ...state, status: "declined", winner: null, endReason: "decline" };
  }
  return { ...state, status: "forfeit", winner: otherSeat(state, uid), endReason: "quit" };
}

/** Opponent-only, and only before play has started. */
export function applyDecline(state: DiceMatch, uid: string): DiceMatch {
  const open = state.status === "pending" || (state.status === "active" && !matchHasStarted(state));
  if (!open || uid !== state.seats[1]) throw new Error("NOT_DECLINABLE");
  return { ...state, status: "declined", winner: null, endReason: "decline" };
}

/** A decided match (target reached or forfeit) is the only ending that moves records and Rep. */
export function statsDelta(state: DiceMatch): { winnerUid: string; loserUid: string } | null {
  if ((state.status !== "forfeit" && state.status !== "complete") || !state.winner) return null;
  return { winnerUid: state.winner, loserUid: otherSeat(state, state.winner) };
}
