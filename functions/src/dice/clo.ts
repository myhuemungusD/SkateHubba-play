// Vendored from myhuemungusD/got-em src/scoring/clo.ts @ ea14902 (MIT, same author).
// Copied unchanged so SkateHubba and Got Em score C-Lo the same way. The
// tests in clo.test.ts travel with this file; do not "improve" the ranks.
export type CloResult =
  | { outcome: "win"; label: string; rank: number }
  | { outcome: "loss"; label: string; rank: number }
  | { outcome: "point"; point: number; label: string; rank: number }
  | { outcome: "reroll"; label: string; rank: null };

export function cloResolve(roll: readonly number[]): CloResult {
  const sorted = [...roll].sort((a, b) => a - b);
  const [a = 0, b = 0, c = 0] = sorted;
  const s = sorted.join("");
  if (s === "456") return { outcome: "win", label: "4-5-6", rank: 1000 };
  if (s === "123") return { outcome: "loss", label: "1-2-3 OUT", rank: -1000 };
  if (a === b && b === c) {
    return { outcome: "win", label: `TRIPLE ${a}s`, rank: 100 + a };
  }
  if (a === b) {
    return { outcome: "point", point: c, label: `POINT ${c}`, rank: c };
  }
  if (b === c) {
    return { outcome: "point", point: a, label: `POINT ${a}`, rank: a };
  }
  if (a === c) {
    return { outcome: "point", point: b, label: `POINT ${b}`, rank: b };
  }
  return { outcome: "reroll", label: "RE-ROLL", rank: null };
}
