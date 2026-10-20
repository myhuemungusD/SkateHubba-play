/**
 * Roll Dice document shapes and mappers. Pure: no Firebase imports, so the
 * screens and tests can use the types without pulling in the SDK.
 *
 * v1 matches (C-Lo, endless rounds) still map: they read as C-Lo races to
 * 5, with rounds already won counted as points, the same way the server
 * loads them.
 */
export type DiceMode = "clo" | "s456" | "craps" | "ten";
export type DiceStatus = "pending" | "active" | "complete" | "forfeit" | "declined" | "expired";
export type DiceEndReason = "target" | "quit" | "timeout" | "decline" | "cancel";

export const DICE_MODES: readonly DiceMode[] = ["clo", "s456", "craps", "ten"];

/** Allowed race-to targets per game. The first is the default. Mirrors functions/src/dice/modes.ts. */
export const DICE_TARGETS: Readonly<Record<DiceMode, readonly number[]>> = {
  clo: [5, 9],
  s456: [5, 9],
  craps: [5, 9],
  ten: [5000, 10000],
};

const DEFAULT_TARGET: Readonly<Record<DiceMode, number>> = { clo: 5, s456: 5, craps: 5, ten: 5000 };

export interface DiceHand {
  dice: number[];
  label: string;
}

export interface DiceRollView {
  uid: string;
  dice: number[];
  outcome: string;
  label: string;
  callout: string | null;
  rollId: string;
  at: number;
}

export interface DiceRoundView {
  round: number;
  winner: string | null;
  points: number;
  label: string;
  hands: Record<string, DiceHand>;
  at: number;
}

export interface DiceTenView {
  turnScore: number;
  kept: number[];
  rolled: number[];
}

export interface DiceGameDoc {
  id: string;
  player1Uid: string;
  player2Uid: string;
  player1Username: string;
  player2Username: string;
  mode: DiceMode;
  target: number;
  status: DiceStatus;
  currentTurn: string | null;
  round: number;
  scores: Record<string, number>;
  roundsWon: Record<string, number>;
  /** C-Lo / 4-5-6: settled dice this round, keyed by uid. */
  results: Record<string, number[]>;
  point: number | null;
  ten: DiceTenView;
  turns: Record<string, number>;
  rollCount: number;
  accepted: boolean;
  winner: string | null;
  endReason: DiceEndReason | null;
  updatedAt: number;
  createdAt: number;
  turnDeadline: number;
  lastRoll: DiceRollView | null;
  rounds: DiceRoundView[];
  repChange: Record<string, number> | null;
  rematchGameId: string | null;
  nudgedAt: number | null;
}

export interface DiceStatsDoc {
  wins: number;
  losses: number;
  gamesPlayed: number;
  rep: number;
  peakRep: number;
  streak: number;
  bestStreak: number;
}

export const REP_START = 1000;

const STATUSES: readonly DiceStatus[] = ["pending", "active", "complete", "forfeit", "declined", "expired"];
const END_REASONS: readonly DiceEndReason[] = ["target", "quit", "timeout", "decline", "cancel"];

type Row = Record<string, unknown>;

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function row(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : null;
}

function faces(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 6) return null;
  return value.every((face) => typeof face === "number" && face >= 1 && face <= 6) ? (value as number[]) : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function isDiceMode(value: unknown): value is DiceMode {
  return oneOf(value, DICE_MODES) !== null;
}

function perSeat(raw: unknown, p1: string, p2: string): Record<string, number> | null {
  const record = row(raw);
  if (!record) return null;
  return { [p1]: finite(record[p1], 0), [p2]: finite(record[p2], 0) };
}

function lastRollOf(raw: unknown): DiceRollView | null {
  const r = row(raw);
  const dice = faces(r?.dice);
  if (!r || !dice) return null;
  return {
    uid: text(r.uid, ""),
    dice,
    outcome: text(r.outcome, ""),
    label: text(r.label, ""),
    callout: typeof r.callout === "string" ? r.callout : null,
    rollId: text(r.rollId, `${text(r.uid, "")}:${finite(r.at, 0)}:${dice.join("")}`),
    at: finite(r.at, 0),
  };
}

function handsOf(raw: unknown): Record<string, DiceHand> {
  const out: Record<string, DiceHand> = {};
  for (const [uid, value] of Object.entries(row(raw) ?? {})) {
    const dice = faces(row(value)?.dice);
    if (dice) out[uid] = { dice, label: text(row(value)?.label, "") };
  }
  return out;
}

function roundsOf(raw: unknown): DiceRoundView[] {
  if (!Array.isArray(raw)) return [];
  const out: DiceRoundView[] = [];
  for (const item of raw) {
    const r = row(item);
    if (!r) continue;
    out.push({
      round: finite(r.round, out.length + 1),
      winner: typeof r.winner === "string" ? r.winner : null,
      points: finite(r.points, 0),
      label: text(r.label, ""),
      hands: handsOf(r.hands),
      at: finite(r.at, 0),
    });
  }
  return out;
}

function resultsOf(raw: unknown): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [uid, value] of Object.entries(row(raw) ?? {})) {
    const dice = faces(row(value)?.dice);
    if (dice && dice.length === 3) out[uid] = dice;
  }
  return out;
}

function tenOf(raw: unknown): DiceTenView {
  const r = row(raw);
  return {
    turnScore: finite(r?.turnScore, 0),
    kept: faces(r?.kept) ?? [],
    rolled: faces(r?.rolled) ?? [],
  };
}

function repOf(raw: unknown, p1: string, p2: string): Record<string, number> | null {
  const r = row(raw);
  if (!r) return null;
  const seats = [p1, p2].filter((uid) => typeof r[uid] === "number");
  return seats.length > 0 ? Object.fromEntries(seats.map((uid) => [uid, r[uid] as number])) : null;
}

/** Map a diceGames document. Returns null when the shape is not a match. */
export function toDiceGame(id: string, raw: Row | undefined): DiceGameDoc | null {
  if (!raw) return null;
  const player1Uid = raw.player1Uid;
  const player2Uid = raw.player2Uid;
  if (typeof player1Uid !== "string" || player1Uid.length === 0) return null;
  if (typeof player2Uid !== "string" || player2Uid.length === 0) return null;
  const status = oneOf(raw.status, STATUSES);
  if (!status) return null;
  const mode = oneOf(raw.game, DICE_MODES) ?? "clo";
  const target = finite(raw.target, 0);
  const roundsWon = perSeat(raw.roundsWon, player1Uid, player2Uid) ?? { [player1Uid]: 0, [player2Uid]: 0 };
  const point = raw.point;
  return {
    id,
    player1Uid,
    player2Uid,
    player1Username: text(raw.player1Username, ""),
    player2Username: text(raw.player2Username, ""),
    mode,
    target: DICE_TARGETS[mode].includes(target) ? target : DEFAULT_TARGET[mode],
    status,
    currentTurn: typeof raw.currentTurn === "string" ? raw.currentTurn : null,
    round: finite(raw.round, 1),
    scores: perSeat(raw.scores, player1Uid, player2Uid) ?? { ...roundsWon },
    roundsWon,
    results: resultsOf(raw.results),
    point: typeof point === "number" ? point : null,
    ten: tenOf(raw.ten),
    turns: perSeat(raw.turns, player1Uid, player2Uid) ?? { [player1Uid]: 0, [player2Uid]: 0 },
    rollCount: finite(raw.rollCount, 0),
    accepted: raw.accepted === true,
    winner: typeof raw.winner === "string" ? raw.winner : null,
    endReason: oneOf(raw.endReason, END_REASONS),
    updatedAt: finite(raw.updatedAt, 0),
    createdAt: finite(raw.createdAt, 0),
    turnDeadline: finite(raw.turnDeadline, 0),
    lastRoll: lastRollOf(raw.lastRoll),
    rounds: roundsOf(raw.rounds),
    repChange: repOf(raw.repChange, player1Uid, player2Uid),
    rematchGameId: typeof raw.rematchGameId === "string" && raw.rematchGameId.length > 0 ? raw.rematchGameId : null,
    nudgedAt: typeof raw.nudgedAt === "number" ? raw.nudgedAt : null,
  };
}

export function toDiceStats(raw: Row | undefined): DiceStatsDoc {
  const rep = finite(raw?.rep, REP_START);
  return {
    wins: finite(raw?.wins, 0),
    losses: finite(raw?.losses, 0),
    gamesPlayed: finite(raw?.gamesPlayed, 0),
    rep,
    peakRep: Math.max(rep, finite(raw?.peakRep, REP_START)),
    streak: finite(raw?.streak, 0),
    bestStreak: finite(raw?.bestStreak, 0),
  };
}
