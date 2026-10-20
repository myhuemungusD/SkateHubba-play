/**
 * Roll rules for each game. Pure: the handler rolls the dice (inside the
 * transaction) and passes them in, so tests can drive any outcome.
 *
 * C-Lo: both players throw three dice each round. No pair, no 4-5-6, no
 *   1-2-3 = throw again. Best hand takes the round and scores its points.
 *   A tie replays the round.
 * 4-5-6: C-Lo hands, but 4-5-6 or trips wins the round on the spot, and
 *   1-2-3 loses it on the spot. A point still has to be beaten.
 * Craps: players alternate hands. Come-out 7/11 = natural, 2/3/12 = craps
 *   (no score), anything else sets the point; then hit the point before a 7.
 * 10,000: players alternate turns. Set aside scoring dice, then roll the
 *   rest or bank. A roll with nothing scoring is a farkle and the turn's
 *   points are lost. All six set aside = hot dice, roll all six again.
 */
import { cloResolve } from "./clo.js";
import { crapsResolve } from "./craps.js";
import { ten10kScoreCombo } from "./farkle.js";
import { cloHandPoints, crapsHandPoints } from "./points.js";
import { EMPTY_TEN, assertTurn, otherSeat, seatIndex, settleMatch, type DiceMatch, type TenState } from "./engine.js";

/** 1,050 rather than 1050 in labels people read. */
function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export interface HandView {
  dice: number[];
  label: string;
}

/** One finished round (C-Lo, 4-5-6) or hand (craps, 10,000), for the history list. */
export interface RoundRecord {
  round: number;
  winner: string | null;
  points: number;
  label: string;
  hands: Record<string, HandView>;
}

export type RollEffect =
  | { type: "again" }
  | { type: "advance"; nextUid: string }
  | { type: "tie"; nextUid: string }
  | { type: "round"; winnerUid: string | null; points: number; nextUid: string };

export interface AppliedRoll {
  state: DiceMatch;
  effect: RollEffect;
  label: string;
  outcome: string;
  /** A short skate word for the rare big moments only. Null on ordinary rolls. */
  callout: string | null;
  dice: readonly number[];
  record: RoundRecord | null;
}

function assertDice(dice: readonly number[], count: number): void {
  if (dice.length !== count || dice.some((n) => !Number.isInteger(n) || n < 1 || n > 6)) {
    throw new Error("BAD_DICE");
  }
}

/** Plain-words label for a C-Lo hand. */
export function cloLabel(dice: readonly number[]): string {
  const result = cloResolve(dice);
  if (result.outcome === "reroll") return "No point";
  if (result.outcome === "loss") return "1-2-3";
  if (result.outcome === "point") return `Point ${result.point}`;
  return result.rank === 1000 ? "4-5-6" : `Trips ${result.rank - 100}s`;
}

function cloCallout(dice: readonly number[]): string | null {
  const result = cloResolve(dice);
  if (result.outcome === "win" && result.rank === 1000) return "Clean";
  if (result.outcome === "loss") return "Bail";
  return null;
}

function handsOf(rolls: Readonly<Record<string, readonly number[]>>): Record<string, HandView> {
  const out: Record<string, HandView> = {};
  for (const [uid, dice] of Object.entries(rolls)) out[uid] = { dice: [...dice], label: cloLabel(dice) };
  return out;
}

/** Score a won round, start the next one, and settle the match if the target is reached. */
function closeCloRound(
  state: DiceMatch,
  rolls: Readonly<Record<string, readonly number[]>>,
  winnerUid: string,
  points: number,
  rollCount: number,
): { state: DiceMatch; record: RoundRecord; nextUid: string } {
  const round = state.round + 1;
  const opener = (round - 1) % state.seats.length;
  const next: DiceMatch = {
    ...state,
    rolls: {},
    scores: { ...state.scores, [winnerUid]: (state.scores[winnerUid] ?? 0) + points },
    roundsWon: { ...state.roundsWon, [winnerUid]: (state.roundsWon[winnerUid] ?? 0) + 1 },
    round,
    current: opener,
    rollCount,
  };
  const winnerDice = rolls[winnerUid];
  const record: RoundRecord = {
    round: state.round,
    winner: winnerUid,
    points,
    label: winnerDice ? cloLabel(winnerDice) : "1-2-3",
    hands: handsOf(rolls),
  };
  return { state: settleMatch(next), record, nextUid: state.seats[opener] ?? winnerUid };
}

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
  assertTurn(state, uid);
  if (state.mode !== "clo" && state.mode !== "s456") throw new Error("WRONG_MODE");
  assertDice(dice, 3);
  const result = cloResolve(dice);
  const rollCount = state.rollCount + 1;
  const base = { label: cloLabel(dice), outcome: result.outcome, callout: cloCallout(dice), dice };

  if (result.outcome === "reroll") {
    return { state: { ...state, rollCount }, effect: { type: "again" }, record: null, ...base };
  }

  const rolls: Record<string, readonly number[]> = { ...state.rolls, [uid]: dice };

  if (state.mode === "s456" && result.outcome !== "point") {
    const winnerUid = result.outcome === "win" ? uid : otherSeat(state, uid);
    const points = result.outcome === "win" ? cloHandPoints(dice) : 1;
    const closed = closeCloRound(state, rolls, winnerUid, points, rollCount);
    return {
      state: closed.state,
      effect: { type: "round", winnerUid, points, nextUid: closed.nextUid },
      record: closed.record,
      ...base,
    };
  }

  if (!state.seats.every((seat) => rolls[seat] !== undefined)) {
    const next = nextUnrolled(state, rolls);
    const nextUid = state.seats[next] ?? otherSeat(state, uid);
    return {
      state: { ...state, rolls, current: next, rollCount },
      effect: { type: "advance", nextUid },
      record: null,
      ...base,
    };
  }

  const ranked = state.seats
    .map((seat) => ({ uid: seat, rank: cloResolve(rolls[seat] ?? []).rank ?? Number.NEGATIVE_INFINITY }))
    .sort((a, b) => b.rank - a.rank);
  const top = ranked[0];
  if (!top) throw new Error("MISSING_ROLL");
  const tied = ranked.filter((row) => row.rank === top.rank);

  if (tied.length > 1) {
    const tiedUids = new Set(tied.map((row) => row.uid));
    const kept: Record<string, readonly number[]> = {};
    for (const [seat, settled] of Object.entries(rolls)) if (!tiedUids.has(seat)) kept[seat] = settled;
    const firstTied = Math.max(
      0,
      state.seats.findIndex((seat) => tiedUids.has(seat)),
    );
    const record: RoundRecord = { round: state.round, winner: null, points: 0, label: "Tie", hands: handsOf(rolls) };
    return {
      state: { ...state, rolls: kept, current: firstTied, round: state.round + 1, rollCount },
      effect: { type: "tie", nextUid: state.seats[firstTied] ?? uid },
      record,
      ...base,
    };
  }

  const points = cloHandPoints(rolls[top.uid] ?? []);
  const closed = closeCloRound(state, rolls, top.uid, points, rollCount);
  return {
    state: closed.state,
    effect: { type: "round", winnerUid: top.uid, points, nextUid: closed.nextUid },
    record: closed.record,
    ...base,
  };
}

/** End the current player's hand in an alternating game and pass the dice. */
function endHand(
  state: DiceMatch,
  uid: string,
  points: number,
  label: string,
  dice: readonly number[],
  rollCount: number,
): { state: DiceMatch; record: RoundRecord; effect: RollEffect } {
  const turns = { ...state.turns, [uid]: (state.turns[uid] ?? 0) + 1 };
  const nextIdx = (seatIndex(state, uid) + 1) % state.seats.length;
  const next: DiceMatch = {
    ...state,
    scores: { ...state.scores, [uid]: (state.scores[uid] ?? 0) + points },
    roundsWon: points > 0 ? { ...state.roundsWon, [uid]: (state.roundsWon[uid] ?? 0) + 1 } : state.roundsWon,
    turns,
    point: null,
    ten: EMPTY_TEN,
    current: nextIdx,
    round: Math.min(...state.seats.map((seat) => turns[seat] ?? 0)) + 1,
    rollCount,
  };
  const record: RoundRecord = {
    round: state.round,
    winner: points > 0 ? uid : null,
    points,
    label,
    hands: { [uid]: { dice: [...dice], label } },
  };
  const nextUid = state.seats[nextIdx] ?? uid;
  return { state: settleMatch(next), record, effect: { type: "round", winnerUid: record.winner, points, nextUid } };
}

export function applyCrapsRoll(state: DiceMatch, uid: string, dice: readonly number[]): AppliedRoll {
  assertTurn(state, uid);
  if (state.mode !== "craps") throw new Error("WRONG_MODE");
  assertDice(dice, 2);
  const comeOut = state.point === null;
  const result = crapsResolve(dice, comeOut ? "comeout" : "point", state.point);
  const rollCount = state.rollCount + 1;

  if (result.outcome === "point") {
    const label = `Point ${result.point}`;
    return {
      state: { ...state, point: result.point, rollCount },
      effect: { type: "again" },
      label,
      outcome: "point",
      callout: null,
      dice,
      record: null,
    };
  }
  if (result.outcome === "continue") {
    return {
      state: { ...state, rollCount },
      effect: { type: "again" },
      label: `${result.sum} · still on ${state.point}`,
      outcome: "continue",
      callout: null,
      dice,
      record: null,
    };
  }
  const won = result.outcome === "win";
  const points = crapsHandPoints(won, comeOut, state.point);
  let label: string;
  let outcome: string;
  if (comeOut) {
    label = won ? `Natural ${result.sum}` : `Craps ${result.sum}`;
    outcome = won ? "natural" : "craps";
  } else {
    label = won ? `Made the ${state.point}` : "Seven out";
    outcome = won ? "made" : "sevenout";
  }
  const ended = endHand(state, uid, points, label, dice, rollCount);
  return { ...ended, label, outcome, callout: null, dice };
}

/** Validate a keep choice and fold it into the turn. */
function takeKeep(ten: TenState, keep: readonly number[]): { turnScore: number; kept: number[]; hot: boolean } {
  if (ten.rolled.length === 0) {
    if (keep.length > 0) throw new Error("BAD_KEEP");
    return { turnScore: ten.turnScore, kept: [...ten.kept], hot: false };
  }
  const seen = new Set<number>();
  for (const idx of keep) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= ten.rolled.length || seen.has(idx)) throw new Error("BAD_KEEP");
    seen.add(idx);
  }
  const values = keep.map((idx) => ten.rolled[idx] ?? 0);
  const { score, used } = ten10kScoreCombo(values);
  if (values.length === 0 || score === 0 || !used.every(Boolean)) throw new Error("BAD_KEEP");
  const kept = [...ten.kept, ...values];
  const hot = kept.length >= 6;
  return { turnScore: ten.turnScore + score, kept: hot ? [] : kept, hot };
}

/** How many dice the next 10,000 roll throws after this keep. Throws on a bad keep. */
export function tenRollCount(state: DiceMatch, uid: string, keep: readonly number[]): number {
  assertTurn(state, uid);
  if (state.mode !== "ten") throw new Error("WRONG_MODE");
  return 6 - takeKeep(state.ten, keep).kept.length;
}

export function applyTenRoll(
  state: DiceMatch,
  uid: string,
  keep: readonly number[],
  dice: readonly number[],
): AppliedRoll {
  const count = tenRollCount(state, uid, keep);
  assertDice(dice, count);
  const taken = takeKeep(state.ten, keep);
  const rollCount = state.rollCount + 1;
  const best = ten10kScoreCombo(dice).score;
  if (best === 0) {
    const label = taken.turnScore > 0 ? `Farkle · lost ${fmt(taken.turnScore)}` : "Farkle";
    const ended = endHand(state, uid, 0, label, dice, rollCount);
    return { ...ended, label, outcome: "farkle", callout: "Bail", dice };
  }
  return {
    state: { ...state, ten: { turnScore: taken.turnScore, kept: taken.kept, rolled: [...dice] }, rollCount },
    effect: { type: "again" },
    label: taken.hot ? "Hot dice" : `Up to ${fmt(best)} on the table`,
    outcome: taken.hot ? "hot" : "rolled",
    callout: taken.hot ? "Hot dice" : null,
    dice,
    record: null,
  };
}

export function applyTenBank(state: DiceMatch, uid: string, keep: readonly number[]): AppliedRoll {
  assertTurn(state, uid);
  if (state.mode !== "ten") throw new Error("WRONG_MODE");
  if (state.ten.rolled.length === 0) throw new Error("NOTHING_TO_BANK");
  const taken = takeKeep(state.ten, keep);
  const label = `Banked ${fmt(taken.turnScore)}`;
  const dice = keep.map((idx) => state.ten.rolled[idx] ?? 0);
  const ended = endHand(state, uid, taken.turnScore, label, dice, state.rollCount);
  return { ...ended, label, outcome: "banked", callout: null, dice };
}
