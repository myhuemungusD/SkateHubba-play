// Vendored from myhuemungusD/got-em src/scoring/craps.ts @ ea14902 (MIT, same author).
// Copied unchanged so SkateHubba and Got Em resolve craps rolls the same way.
export type CrapsPhase = "comeout" | "point";

export type CrapsResult =
  | { outcome: "win"; sum: number; label: string }
  | { outcome: "loss"; sum: number; label: string }
  | { outcome: "point"; sum: number; point: number; label: string }
  | { outcome: "continue"; sum: number; label: string };

export function crapsResolve(roll: readonly number[], phase: CrapsPhase, point: number | null): CrapsResult {
  const [a = 0, b = 0] = roll;
  const sum = a + b;
  if (phase === "comeout") {
    if (sum === 7 || sum === 11) return { outcome: "win", sum, label: `${sum} · WIN` };
    if (sum === 2 || sum === 3 || sum === 12) return { outcome: "loss", sum, label: "CRAPS" };
    return { outcome: "point", sum, point: sum, label: `POINT ${sum}` };
  }
  if (sum === point) return { outcome: "win", sum, label: "POINT MADE" };
  if (sum === 7) return { outcome: "loss", sum, label: "SEVEN OUT" };
  return { outcome: "continue", sum, label: `${sum}` };
}
