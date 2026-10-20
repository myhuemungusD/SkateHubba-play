/**
 * diceGames document <-> engine state.
 *
 * v1 matches (C-Lo, endless rounds, no accept step) still load: they become
 * C-Lo races to the default target, and every round they already won counts
 * as 1 point. The next write stamps v2 fields onto the doc.
 */
import { cloResolve } from "./clo.js";
import { EMPTY_TEN, type DiceEndReason, type DiceMatch, type DiceStatus, type TenState } from "./engine.js";
import { defaultTarget, isAllowedTarget, isDiceMode } from "./modes.js";

const STATUSES: readonly DiceStatus[] = ["pending", "active", "complete", "forfeit", "declined", "expired"];
const END_REASONS: readonly DiceEndReason[] = ["target", "quit", "timeout", "decline", "cancel"];

export function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function faces(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((face) => typeof face === "number" && Number.isInteger(face) && face >= 1 && face <= 6)
    ? (value as number[])
    : null;
}

function rollsFromResults(raw: unknown): Record<string, readonly number[]> {
  const rolls: Record<string, readonly number[]> = {};
  for (const [uid, value] of Object.entries(asRecord(raw) ?? {})) {
    const dice = faces(asRecord(value)?.dice);
    if (dice && dice.length === 3) rolls[uid] = dice;
  }
  return rolls;
}

function perSeat(raw: unknown, seats: readonly string[]): Record<string, number> | null {
  const record = asRecord(raw);
  if (!record) return null;
  const out: Record<string, number> = {};
  for (const seat of seats) out[seat] = num(record[seat]);
  return out;
}

function tenFrom(raw: unknown): TenState {
  const record = asRecord(raw);
  if (!record) return EMPTY_TEN;
  return {
    turnScore: num(record.turnScore),
    kept: faces(record.kept) ?? [],
    rolled: faces(record.rolled) ?? [],
  };
}

export function matchFromData(data: Record<string, unknown>): DiceMatch | null {
  const p1 = data.player1Uid;
  const p2 = data.player2Uid;
  if (typeof p1 !== "string" || typeof p2 !== "string" || p1.length === 0 || p2.length === 0) return null;
  const status = data.status;
  if (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status)) return null;
  const seats: readonly string[] = [p1, p2];
  const mode = isDiceMode(data.game) ? data.game : "clo";
  const target = isAllowedTarget(mode, data.target) ? data.target : defaultTarget(mode);
  const turn = data.currentTurn;
  const found = typeof turn === "string" ? seats.indexOf(turn) : -1;
  const roundsWon = perSeat(data.roundsWon, seats) ?? { [p1]: 0, [p2]: 0 };
  const point = data.point;
  const endReason = data.endReason;
  return {
    mode,
    target,
    status: status as DiceStatus,
    seats,
    current: found >= 0 ? found : 0,
    round: Math.max(1, num(data.round) || 1),
    scores: perSeat(data.scores, seats) ?? { ...roundsWon },
    roundsWon,
    rolls: rollsFromResults(data.results),
    point: typeof point === "number" && [4, 5, 6, 8, 9, 10].includes(point) ? point : null,
    ten: tenFrom(data.ten),
    turns: perSeat(data.turns, seats) ?? { [p1]: 0, [p2]: 0 },
    rollCount: num(data.rollCount),
    accepted: data.accepted === true,
    winner: typeof data.winner === "string" ? data.winner : null,
    endReason:
      typeof endReason === "string" && (END_REASONS as readonly string[]).includes(endReason)
        ? (endReason as DiceEndReason)
        : null,
  };
}

function resultsFromRolls(rolls: Readonly<Record<string, readonly number[]>>): Record<string, unknown> {
  const results: Record<string, unknown> = {};
  for (const [uid, dice] of Object.entries(rolls)) {
    const resolved = cloResolve(dice);
    if (resolved.rank === null) continue;
    results[uid] = { dice: [...dice], outcome: resolved.outcome, rank: resolved.rank };
  }
  return results;
}

/** Whose move it is: the roller while active, nobody otherwise. */
export function currentTurnOf(state: DiceMatch): string | null {
  return state.status === "active" ? (state.seats[state.current] ?? null) : null;
}

export function stateFields(state: DiceMatch, nowMs: number): Record<string, unknown> {
  return {
    v: 2,
    game: state.mode,
    target: state.target,
    status: state.status,
    currentTurn: currentTurnOf(state),
    round: state.round,
    scores: { ...state.scores },
    roundsWon: { ...state.roundsWon },
    results: resultsFromRolls(state.rolls),
    point: state.point,
    ten: { turnScore: state.ten.turnScore, kept: [...state.ten.kept], rolled: [...state.ten.rolled] },
    turns: { ...state.turns },
    rollCount: state.rollCount,
    accepted: state.accepted,
    winner: state.winner,
    endReason: state.endReason,
    updatedAt: nowMs,
  };
}

export function namesFrom(data: Record<string, unknown>, state: DiceMatch): Record<string, string> {
  const names: Record<string, string> = {};
  const [p1, p2] = state.seats;
  if (p1 && typeof data.player1Username === "string") names[p1] = data.player1Username;
  if (p2 && typeof data.player2Username === "string") names[p2] = data.player2Username;
  return names;
}

export function appendCapped(existing: unknown, entry: Record<string, unknown>, cap: number): unknown[] {
  const list = Array.isArray(existing) ? existing.slice() : [];
  list.push(entry);
  return list.length <= cap ? list : list.slice(list.length - cap);
}
