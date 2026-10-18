/**
 * Tap-to-fill: a scanline flood fill. The region is found on the `boundary`
 * pixels (the template's line art composited with the user's paint) and the
 * color is written into `target` (the active layer), so a fill never paints
 * over the template itself and undo stays per-layer.
 */

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function close(d: Uint8ClampedArray, i: number, seed: readonly number[], tol: number): boolean {
  return (
    Math.abs(d[i] - seed[0]) <= tol &&
    Math.abs(d[i + 1] - seed[1]) <= tol &&
    Math.abs(d[i + 2] - seed[2]) <= tol &&
    Math.abs(d[i + 3] - seed[3]) <= tol
  );
}

/** Returns the number of pixels filled (0 when the point is outside). */
export function floodFill(
  boundary: Pixels,
  target: Pixels,
  x: number,
  y: number,
  rgba: readonly [number, number, number, number],
  tolerance = 32,
): number {
  const { width: w, height: h, data: b } = boundary;
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= w || py >= h || target.width !== w || target.height !== h) return 0;
  const i0 = (py * w + px) * 4;
  const seed = [b[i0], b[i0 + 1], b[i0 + 2], b[i0 + 3]];
  const seen = new Uint8Array(w * h);
  const stack: number[] = [px, py];
  let count = 0;
  while (stack.length) {
    const sy = stack.pop() as number;
    let sx = stack.pop() as number;
    while (sx > 0 && !seen[sy * w + sx - 1] && close(b, (sy * w + sx - 1) * 4, seed, tolerance)) sx--;
    let up = false;
    let down = false;
    for (; sx < w; sx++) {
      const p = sy * w + sx;
      if (seen[p] || !close(b, p * 4, seed, tolerance)) break;
      seen[p] = 1;
      target.data.set(rgba, p * 4);
      count++;
      if (sy > 0) {
        const ok = !seen[p - w] && close(b, (p - w) * 4, seed, tolerance);
        if (ok && !up) stack.push(sx, sy - 1);
        up = ok;
      }
      if (sy < h - 1) {
        const ok = !seen[p + w] && close(b, (p + w) * 4, seed, tolerance);
        if (ok && !down) stack.push(sx, sy + 1);
        down = ok;
      }
    }
  }
  return count;
}
