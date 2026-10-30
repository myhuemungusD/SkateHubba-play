/** Stroke + viewport math (pure, no DOM). */

export interface Pt {
  x: number;
  y: number;
}

/** Evenly spaced dabs from a to b (spacing in canvas px), excluding a. */
export function interpolate(a: Pt, b: Pt, spacing: number): Pt[] {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const step = Math.max(0.5, spacing);
  const n = Math.max(1, Math.floor(dist / step));
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
  return out;
}

/** Left/right mirror across the vertical center line. */
export function mirror(p: Pt, width: number): Pt {
  return { x: width - p.x, y: p.y };
}

export function withSymmetry(points: Pt[], width: number, on: boolean): Pt[] {
  return on ? points.flatMap((p) => [p, mirror(p, width)]) : points;
}

/** Client coords → canvas coords using the element's on-screen rect (CSS transforms included). */
export function toCanvas(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  size: number,
): Pt {
  return { x: ((clientX - rect.left) / rect.width) * size, y: ((clientY - rect.top) / rect.height) * size };
}

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}
const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

/** Two-finger gesture: scale by the change in finger distance, pan by the midpoint move. */
export function pinch(view: View, a0: Pt, b0: Pt, a1: Pt, b1: Pt): View {
  const d0 = Math.max(1, Math.hypot(b0.x - a0.x, b0.y - a0.y));
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * (d1 / d0)));
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  return zoom === MIN_ZOOM
    ? { zoom, panX: 0, panY: 0 }
    : { zoom, panX: view.panX + m1.x - m0.x, panY: view.panY + m1.y - m0.y };
}
