import { LEAN_PX } from "./tune";
import type { Action } from "./types";

/** Pixels of travel before a swipe commits. Felt on the way, not on release. */
export const SWIPE_THRESHOLD_PX = 28;

/**
 * Touches that start this close to either screen edge are left for the
 * browser, so iOS swipe-back and Android gesture-nav keep working.
 */
export const EDGE_DEAD_ZONE_PX = 32;

export interface PointerPoint {
  x: number;
  y: number;
}

export interface GestureRecognizer {
  /** False when the touch started in the edge dead zone and is not ours. */
  down(point: PointerPoint, viewportWidth: number): boolean;
  /** The action, once, when the finger crosses the threshold. */
  move(point: PointerPoint): Action | null;
  /**
   * Horizontal hold after a swipe has committed. -1 is full left, 1 is full
   * right, 0 before the swipe or when the finger is mostly vertical.
   */
  lean(point: PointerPoint): number;
  /** True after a non-edge touchstart until touchend. */
  ownsGesture(): boolean;
  /**
   * A lift that never crossed the swipe threshold is a tap (crooked grind,
   * or a nose slide when it is the second tap). A finished swipe returns null.
   */
  up(): Action | null;
}

export function createGestureRecognizer(threshold = SWIPE_THRESHOLD_PX, edge = EDGE_DEAD_ZONE_PX): GestureRecognizer {
  let origin: PointerPoint | null = null;
  let fired = false;
  let owned = false;

  return {
    down(point, viewportWidth) {
      const inEdge = point.x < edge || point.x > viewportWidth - edge;
      owned = !inEdge;
      origin = owned ? point : null;
      fired = false;
      return owned;
    },
    move(point) {
      if (!origin || fired || !owned) return null;
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return null;
      fired = true;
      if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
      // Screen Y grows downward. Up is the kickflip-in. Down is the powerslide.
      return dy > 0 ? "duck" : "flip";
    },
    lean(point) {
      if (!origin || !owned || !fired) return 0;
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      if (Math.abs(dy) > Math.abs(dx)) return 0;
      return Math.max(-1, Math.min(1, dx / LEAN_PX));
    },
    ownsGesture() {
      return owned;
    },
    up() {
      const tapped = owned && !fired && origin !== null;
      origin = null;
      fired = false;
      owned = false;
      return tapped ? "tap" : null;
    },
  };
}

/**
 * Touch listeners for the playfield. `touchmove` is non-passive so a gesture
 * we own can cancel page scroll. Edge touches are not prevented, which leaves
 * the iOS back-swipe alone. The action fires inside `touchmove` once the
 * threshold is crossed — Subway Surfers feel, not a release-to-act swipe.
 */
export function bindRunnerTouch(
  el: HTMLElement,
  recognize: GestureRecognizer,
  onAction: (action: Action) => void,
  onLean?: (lean: number) => void,
): () => void {
  const point = (touch: { clientX: number; clientY: number }): PointerPoint => ({
    x: touch.clientX,
    y: touch.clientY,
  });

  const down = (event: TouchEvent) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    recognize.down(point(touch), window.innerWidth);
  };

  const move = (event: TouchEvent) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    if (recognize.ownsGesture()) event.preventDefault();
    const here = point(touch);
    const action = recognize.move(here);
    if (action) onAction(action);
    if (onLean) onLean(recognize.lean(here));
  };

  const up = () => {
    const action = recognize.up();
    if (onLean) onLean(0);
    if (action) onAction(action);
  };

  el.addEventListener("touchstart", down, { passive: true });
  el.addEventListener("touchmove", move, { passive: false });
  el.addEventListener("touchend", up);
  el.addEventListener("touchcancel", up);
  return () => {
    el.removeEventListener("touchstart", down);
    el.removeEventListener("touchmove", move);
    el.removeEventListener("touchend", up);
    el.removeEventListener("touchcancel", up);
  };
}
