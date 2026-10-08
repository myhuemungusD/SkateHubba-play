/**
 * Pure C-Lo turn engine for a SkateHubba Roll Dice match.
 *
 * Scoring is {@link cloResolve} (vendored from Got Em). Turn rules follow
 * Got Em's `rollClo` (gameplay.ts @ ea14902): a re-roll keeps the turn, a
 * settled roll is recorded and the turn passes, and when every seat has a
 * roll the highest rank wins. A tie clears only the tied rolls and the turn
 * returns to the first tied seat, skipping anyone who still has a valid roll.
 *
 * One product difference, decided for SkateHubba: a round winner does not
 * end the match. The match is round after round until somebody quits or a
 * turn times out. `roundsWon` counts rounds inside the match. Lifetime
 * wins and losses are applied by the caller only when the match ends in a
 * forfeit (quit or timeout) — never as S.K.A.T.E. stats.
 */
import { cloResolve, type CloResult } from "./clo.js";

export const HISTORY_CAP = 30;
export const TURN_DURATION_MS = 24 * 60 * 60 * 1000;
export const ROLL_COOLDOWN_MS = 1_000;
export const CREATE_COOLDOWN_MS = 10_000;
export const ACTIVE_GAME_CAP = 10;

export type DiceStatus = "active" | "forfeit" | "declined" | "expired";
export type DiceEndReason = "quit" | "timeout" | "decline";

export interface DiceMatch {
  status: DiceStatus;
  /** Seat order. Index 0 is the challenger and opens every new round. */
  seats: readonly string[];
  current: number;
  round: number;
  roundsWon: Readonly<Record<string, number>>;
  /** Settled dice for the current round, keyed by uid. */
  rolls: Readonly<Record<string, readonly number[]>>;
  rollCount: number;
  /** Match winner. Set only when the match ends by quit or timeout. */
  winner: string | null;
  endReason: DiceEndReason | null;
}

export type RollEffect =
  | { type: "reroll" }
  | { type: "advance"; nextUid: string }
  | { type: "tie"; nextUid: string }
  | { type: "round"; roundWinnerUid: string; nextUid: string };

export interface AppliedRoll {
  state: DiceMatch;
  effect: RollEffect;
  label: string;
  outcome: CloResult["outcome"];
  dice: readonly number[];
}

export function freshMatch(seats: readonly string[]): DiceMatch {
  const roundsWon: Record<string, number> = {};
  for (const uid of seats) roundsWon[uid] = 0;
  return {
    status: "active",
    seats,
    current: 0,
    round: 1,
    roundsWon,
    rolls: {},
    rollCount: 0,
    winner: null,
    endReason: null,
  };
}

/** True once anyone has rolled, a round has been won, or a tie restarted the round. */
export function matchHasStarted(state: DiceMatch): boolean {
  if (state.round > 1 || state.rollCount > 0) return true;
  if (Object.keys(state.rolls).length > 0) return true;
  return Object.values(state.roundsWon).some((n) => n > 0);
}

function assertActive(state: DiceMatch): void {
  if (state.status !== "active") throw new Error("NOT_IN_PROGRESS");
}

function assertDice(dice: readonly number[]): void {
  if (dice.length !== 3 || dice.some((n) => !Number.isInteger(n) || n < 1 || n > 6)) {
    throw new Error("BAD_DICE");
  }
}

function otherSeat(state: DiceMatch, uid: string): string {
  const other = state.seats.find((seat) => seat !== uid);
  if (!other) throw new Error("NO_OPPONENT");
  return other;
}

/**
 * Next seat that still owes a settled roll, scanning forward from `current`.
 * During a tie re-roll this skips a seat whose roll was kept.
 */
function nextUnrolled(state: DiceMatch, rolls: Readonly<Record<string, readonly number[]>>): number {
  const count = state.seats.length;
  for (let step = 1; step <= count; step++) {
    const idx = (state.current + step) % count;
    const uid = state.seats[idx];
    if (uid && rolls[uid] === undefined) return idx;
  }
  return state.current;
}

export function applyCloRoll(state: DiceMatch, uid: string, dice: readonly number[]): AppliedRoll {
  assertActive(state);
  if (state.seats[state.current] !== uid) throw new Error("NOT_YOUR_TURN");
  assertDice(dice);

  const result = cloResolve(dice);
  const rollCount = state.rollCount + 1;
  const base = { label: result.label, outcome: result.outcome, dice };

  if (result.outcome === "reroll" || result.rank === null) {
    return { state: { ...state, rollCount }, effect: { type: "reroll" }, ...base };
  }

  const rolls: Record<string, readonly number[]> = { ...state.rolls, [uid]: dice };
  const allDone = state.seats.every((seat) => rolls[seat] !== undefined);
  if (!allDone) {
    const next = nextUnrolled(state, rolls);
    const nextUid = state.seats[next];
    if (!nextUid) throw new Error("NO_OPPONENT");
    return {
      state: { ...state, rolls, current: next, rollCount },
      effect: { type: "advance", nextUid },
      ...base,
    };
  }

  const ranked = state.seats
    .map((seat) => {
      const settled = rolls[seat];
      if (!settled) throw new Error("MISSING_ROLL");
      const rank = cloResolve(settled).rank ?? Number.NEGATIVE_INFINITY;
      return { uid: seat, rank };
    })
    .sort((a, b) => b.rank - a.rank);

  const top = ranked[0];
  if (!top) throw new Error("MISSING_ROLL");
  const tied = ranked.filter((row) => row.rank === top.rank);

  if (tied.length > 1) {
    const tiedUids = new Set(tied.map((row) => row.uid));
    const kept: Record<string, readonly number[]> = {};
    for (const [seat, settled] of Object.entries(rolls)) {
      if (!tiedUids.has(seat)) kept[seat] = settled;
    }
    const firstTied = state.seats.findIndex((seat) => tiedUids.has(seat));
    if (firstTied < 0) throw new Error("TIE_RESOLVE_FAILED");
    const nextUid = state.seats[firstTied];
    if (!nextUid) throw new Error("TIE_RESOLVE_FAILED");
    return {
      state: { ...state, rolls: kept, current: firstTied, round: state.round + 1, rollCount },
      effect: { type: "tie", nextUid },
      ...base,
    };
  }

  const roundsWon = { ...state.roundsWon, [top.uid]: (state.roundsWon[top.uid] ?? 0) + 1 };
  const opener = state.seats[0];
  if (!opener) throw new Error("NO_OPPONENT");
  return {
    state: {
      ...state,
      rolls: {},
      roundsWon,
      current: 0,
      round: state.round + 1,
      rollCount,
      status: "active",
      winner: null,
      endReason: null,
    },
    effect: { type: "round", roundWinnerUid: top.uid, nextUid: opener },
    ...base,
  };
}

export type TimeoutDecision = { action: "none" } | { action: "expired" } | { action: "forfeit"; winnerUid: string };

/**
 * Shared by the callable's claimTimeout action and the scheduled sweep so
 * the two paths cannot disagree. A match the challenger never rolled in
 * (round 1, no rolls at all) expires with no stats. Any later expiry is a
 * forfeit: the player who was waiting wins the match.
 */
export function decideDiceTimeout(state: DiceMatch, nowMs: number, deadlineMs: number): TimeoutDecision {
  if (state.status !== "active") return { action: "none" };
  if (!(nowMs >= deadlineMs)) return { action: "none" };
  if (!matchHasStarted(state)) return { action: "expired" };
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
 * Either player can leave. Before anyone has rolled, the challenger leaving
 * voids the match and the opponent leaving declines it — neither writes a
 * win or a loss. After play has started, leaving forfeits the match to the
 * player who stayed.
 */
export function applyQuit(state: DiceMatch, uid: string): DiceMatch {
  assertActive(state);
  if (!state.seats.includes(uid)) throw new Error("NOT_A_PLAYER");
  if (!matchHasStarted(state)) {
    if (uid === state.seats[0]) {
      return { ...state, status: "expired", winner: null, endReason: "quit" };
    }
    return { ...state, status: "declined", winner: null, endReason: "decline" };
  }
  return { ...state, status: "forfeit", winner: otherSeat(state, uid), endReason: "quit" };
}

/** Opponent-only, and only before the match has started. */
export function applyDecline(state: DiceMatch, uid: string): DiceMatch {
  assertActive(state);
  if (uid !== state.seats[1] || matchHasStarted(state)) throw new Error("NOT_DECLINABLE");
  return { ...state, status: "declined", winner: null, endReason: "decline" };
}

/** A forfeit is the only ending that moves lifetime dice wins and losses. */
export function statsDelta(state: DiceMatch): { winnerUid: string; loserUid: string } | null {
  if (state.status !== "forfeit" || !state.winner) return null;
  const loserUid = otherSeat(state, state.winner);
  return { winnerUid: state.winner, loserUid };
}
