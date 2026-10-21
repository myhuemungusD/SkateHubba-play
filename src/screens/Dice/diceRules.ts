/**
 * Client copies of the scoring rules, for labels, hints and the 10,000 keep
 * preview only. The server re-scores everything; nothing here decides a
 * roll or a point.
 */
import type { DiceGameDoc } from "../../services/dice";

/** C-Lo / 4-5-6 hand, in plain words. Mirrors functions/src/dice/play.ts cloLabel. */
export function cloLabel(dice: readonly number[]): string {
  const [a = 0, b = 0, c = 0] = [...dice].sort((x, y) => x - y);
  const key = `${a}${b}${c}`;
  if (key === "456") return "4-5-6";
  if (key === "123") return "1-2-3";
  if (a === b && b === c) return `Trips ${a}s`;
  if (a === b) return `Point ${c}`;
  if (b === c) return `Point ${a}`;
  return "No point";
}

/** Points a winning C-Lo hand earns: 4-5-6 = 3, trips = 2, a point = 1. */
export function cloPoints(dice: readonly number[]): number {
  const label = cloLabel(dice);
  if (label === "4-5-6") return 3;
  return label.startsWith("Trips") ? 2 : 1;
}

/**
 * 10,000 combo scoring (Got Em's farkle.ts, same results). Returns the score
 * and which dice it used. A keep is valid only if every kept die is used.
 */
export function tenScore(values: readonly number[]): { score: number; used: boolean[] } {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  const used = values.map(() => false);
  let score = 0;
  const mark = (face: number, limit: number): void => {
    let n = 0;
    values.forEach((v, i) => {
      if (v === face && !used[i] && n < limit) {
        used[i] = true;
        n += 1;
      }
    });
  };
  const base = (face: number): number => (face === 1 ? 1000 : face * 100);
  const count = (face: number): number => counts[face] ?? 0;

  for (let f = 1; f <= 6; f++) {
    if (count(f) === 6) {
      score += base(f) * 8;
      counts[f] = 0;
      mark(f, 6);
    }
  }
  if ([1, 2, 3, 4, 5, 6].every((f) => count(f) >= 1)) {
    score += 1500;
    for (let f = 1; f <= 6; f++) {
      counts[f] = count(f) - 1;
      mark(f, 1);
    }
  }
  const pairs = [1, 2, 3, 4, 5, 6].filter((f) => count(f) === 2);
  if (pairs.length === 3) {
    score += 1000;
    for (const f of pairs) {
      counts[f] = 0;
      mark(f, 2);
    }
  }
  for (let f = 1; f <= 6; f++) {
    const n = count(f);
    if (n >= 3) {
      score += base(f) * (n === 5 ? 4 : n === 4 ? 2 : 1);
      counts[f] = 0;
      mark(f, n);
    }
  }
  for (const f of [1, 5]) {
    const n = count(f);
    if (n > 0) {
      score += n * (f === 1 ? 100 : 50);
      counts[f] = 0;
      mark(f, n);
    }
  }
  return { score, used };
}

/** Score of the selected dice, and whether the selection is a legal keep. */
export function tenSelection(
  rolled: readonly number[],
  selected: readonly number[],
): { score: number; valid: boolean } {
  const values = selected.map((i) => rolled[i] ?? 0);
  if (values.length === 0) return { score: 0, valid: false };
  const { score, used } = tenScore(values);
  return { score, valid: score > 0 && used.every(Boolean) };
}

/** Indexes of dice that can score on their own or in a set. Used to dim dead dice. */
export function tenLiveDice(rolled: readonly number[]): Set<number> {
  const { used } = tenScore(rolled);
  return new Set(used.flatMap((u, i) => (u ? [i] : [])));
}

function crapsPointValue(point: number): number {
  return point === 4 || point === 10 ? 3 : 2;
}

/** One line telling the roller what they need, in plain words. */
export function needLine(game: DiceGameDoc, uid: string): string {
  const other = game.player1Uid === uid ? game.player2Uid : game.player1Uid;
  if (game.mode === "craps") {
    if (game.point === null) return "Come-out roll. 7 or 11 scores 1. 2, 3 or 12 ends your hand.";
    return `Your point is ${game.point}. Hit ${game.point} before a 7 for ${crapsPointValue(game.point)} points.`;
  }
  if (game.mode === "ten") {
    if (game.ten.rolled.length > 0) return "Tap scoring dice to set them aside, then roll the rest or bank.";
    if (game.ten.turnScore > 0) return `Hot dice. ${game.ten.turnScore} on the line. Roll all six again.`;
    return "Roll six dice to start your turn.";
  }
  const theirs = game.results[other];
  if (theirs) {
    const label = cloLabel(theirs);
    if (label === "4-5-6") return "They rolled 4-5-6. Only another 4-5-6 ties it.";
    if (label === "1-2-3") return "They rolled 1-2-3. Any point, trips or 4-5-6 takes it.";
    if (label.startsWith("Trips")) return `Beat their ${label}: higher trips or 4-5-6.`;
    return `Beat their ${label}: a higher point, trips or 4-5-6.`;
  }
  if (game.mode === "s456") return "4-5-6 or trips wins on the spot. 1-2-3 loses on the spot.";
  return "Throw until you land a point, trips, 4-5-6 or 1-2-3.";
}
