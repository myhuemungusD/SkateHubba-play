// Vendored from myhuemungusD/got-em src/scoring/farkle.ts @ ea14902 (MIT, same author).
// Copied unchanged (10,000 / Farkle combo scoring). Non-null assertions are
// safe: every index is 1..6 into a 7-slot array.
export interface FarkleScore {
  score: number;
  used: boolean[];
}

export function ten10kScoreCombo(values: readonly number[]): FarkleScore {
  if (!values.length) return { score: 0, used: [] };

  const counts: number[] = [0, 0, 0, 0, 0, 0, 0];
  values.forEach((v) => counts[v]!++);

  let score = 0;
  const used: boolean[] = Array.from({ length: values.length }, () => false);

  for (let v = 1; v <= 6; v++) {
    if (counts[v]! === 6) {
      score += (v === 1 ? 1000 : v * 100) * 8;
      counts[v] = 0;
      values.forEach((x, i) => {
        if (x === v) used[i] = true;
      });
    }
  }

  if ([1, 2, 3, 4, 5, 6].every((v) => counts[v]! >= 1)) {
    score += 1500;
    [1, 2, 3, 4, 5, 6].forEach((v) => {
      counts[v]!--;
      const idx = values.findIndex((x, i) => x === v && !used[i]);
      if (idx >= 0) used[idx] = true;
    });
  }

  const pairs: number[] = [];
  for (let v = 1; v <= 6; v++) if (counts[v]! === 2) pairs.push(v);
  if (pairs.length === 3) {
    score += 1000;
    pairs.forEach((v) => {
      counts[v] = 0;
      let c = 0;
      values.forEach((x, i) => {
        if (x === v && !used[i] && c < 2) {
          used[i] = true;
          c++;
        }
      });
    });
  }

  for (let v = 1; v <= 6; v++) {
    if (counts[v]! >= 3) {
      const base = v === 1 ? 1000 : v * 100;
      if (counts[v]! === 5) score += base * 4;
      else if (counts[v] === 4) score += base * 2;
      else score += base;
      counts[v] = 0;
      values.forEach((x, i) => {
        if (x === v && !used[i]) used[i] = true;
      });
    }
  }

  for (let v = 1; v <= 6; v++) {
    if (counts[v]! > 0 && (v === 1 || v === 5)) {
      const each = v === 1 ? 100 : 50;
      score += counts[v]! * each;
      const need = counts[v]!;
      let m = 0;
      values.forEach((x, i) => {
        if (x === v && !used[i] && m < need) {
          used[i] = true;
          m++;
        }
      });
      counts[v] = 0;
    }
  }

  return { score, used };
}
