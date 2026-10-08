// Vendored from myhuemungusD/got-em src/scoring/dice.ts @ ea14902 (MIT, same author).
// Copied unchanged, including the Math.random fallback and setDieSource seam.
/**
 * A die source produces a single face value in 1..6. The default uses crypto
 * (falling back to Math.random). Tests inject a deterministic source via
 * {@link setDieSource} so gameplay ops — which roll INSIDE a transaction — can
 * be driven to specific outcomes. This is the sanctioned determinism seam.
 */
export type DieSource = () => number;

function cryptoDie(): number {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    let value: number;
    do {
      crypto.getRandomValues(buf);
      value = buf[0]!;
    } while (value >= 0xfffffffa);
    return (value % 6) + 1;
  }
  return Math.floor(Math.random() * 6) + 1;
}

let dieSource: DieSource = cryptoDie;

/**
 * Override the die source (test-only seam). Pass a function returning 1..6.
 * Returns a restore function that reinstates the previous source.
 */
export function setDieSource(src: DieSource): () => void {
  const prev = dieSource;
  dieSource = src;
  return () => {
    dieSource = prev;
  };
}

/** Restore the default crypto-backed die source. */
export function resetDieSource(): void {
  dieSource = cryptoDie;
}

export function rollDie(): number {
  return dieSource();
}

export function rollN(n: number): number[] {
  return Array.from({ length: n }, rollDie);
}
