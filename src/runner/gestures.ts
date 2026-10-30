import { FLICK_SENSITIVITY, LEAN_PX } from "./tune";
import type { Action, FlickGrade } from "./types";

const FULL_FLICK: FlickGrade = { accuracy: 5, speed: 5 };

/** Pixel threshold at a sensitivity of 0–100. 50 keeps the original 28px. */
function swipeThreshold(sensitivity = FLICK_SENSITIVITY): number {
  const slider = Math.max(0, Math.min(100, sensitivity));
  return SWIPE_THRESHOLD_PX * (1.5 - slider / 100);
}

export interface TimedPoint extends PointerPoint {
  /** Milliseconds, from the gesture clock or a pointer timestamp. */
  t: number;
}

/**
 * Accuracy is how straight the stroke is. Speed is pixels per millisecond.
 * Both land on 1–5, the Flick-It style score.
 */
export function gradeFlick(samples: readonly TimedPoint[]): FlickGrade {
  if (samples.length < 2) return FULL_FLICK;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return FULL_FLICK;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const travel = Math.hypot(dx, dy);
  const elapsed = Math.max(1, last.t - first.t);
  const pxPerMs = travel / elapsed;
  let speed: number = 1;
  if (pxPerMs >= 1.3) speed = 5;
  else if (pxPerMs >= 0.8) speed = 4;
  else if (pxPerMs >= 0.4) speed = 3;
  else if (pxPerMs >= 0.15) speed = 2;
  const span = Math.abs(dx) + Math.abs(dy);
  const align = span === 0 ? 1 : Math.max(Math.abs(dx), Math.abs(dy)) / span;
  let accuracy: number = 1;
  if (align >= 0.92) accuracy = 5;
  else if (align >= 0.84) accuracy = 4;
  else if (align >= 0.75) accuracy = 3;
  else if (align >= 0.66) accuracy = 2;
  return { accuracy, speed };
}

/** Pixels of travel before a swipe commits. Felt on the way, not on release. */
const SWIPE_THRESHOLD_PX = 28;

/**
 * Touches that start this close to either screen edge are left for the
 * browser, so iOS swipe-back and Android gesture-nav keep working.
 */
export const EDGE_DEAD_ZONE_PX = 32;

interface PointerPoint {
  x: number;
  y: number;
}

export interface GestureRecognizer {
  /** False when the touch started in the edge dead zone and is not ours. */
  down(point: PointerPoint, viewportWidth: number): boolean;
  /** The action, once, when the finger crosses the threshold. */
  move(point: PointerPoint, timeMs?: number): Action | null;
  /** A high-rate touch sample. Pointer events feed coalesced points here. */
  sample(point: PointerPoint, timeMs: number): void;
  /** Accuracy and speed of the gesture that just fired. */
  grade(): FlickGrade;
  /** 0–100. 50 is the default swipe distance. */
  setSensitivity(sensitivity: number): void;
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
  let distance = threshold;
  let clock = 0;
  let samples: TimedPoint[] = [];
  let lastGrade: FlickGrade = FULL_FLICK;

  return {
    down(point, viewportWidth) {
      const inEdge = point.x < edge || point.x > viewportWidth - edge;
      owned = !inEdge;
      origin = owned ? point : null;
      fired = false;
      clock = 0;
      samples = owned ? [{ ...point, t: 0 }] : [];
      lastGrade = FULL_FLICK;
      return owned;
    },
    sample(point, timeMs) {
      if (!owned || !origin) return;
      samples.push({ ...point, t: timeMs });
    },
    grade() {
      return lastGrade;
    },
    setSensitivity(sensitivity) {
      distance = swipeThreshold(sensitivity);
    },
    move(point, timeMs) {
      if (!origin || fired || !owned) return null;
      const stamp = timeMs ?? clock + 16;
      clock = stamp;
      samples.push({ ...point, t: stamp });
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      if (Math.abs(dx) < distance && Math.abs(dy) < distance) return null;
      fired = true;
      lastGrade = gradeFlick(samples);
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
function touchEventTime(event: TouchEvent): number {
  return Number.isFinite(event.timeStamp) ? event.timeStamp : 0;
}

export function bindRunnerTouch(
  el: HTMLElement,
  recognize: GestureRecognizer,
  onAction: (action: Action, grade: FlickGrade) => void,
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
    const action = recognize.move(here, touchEventTime(event));
    if (action) onAction(action, recognize.grade());
    if (onLean) onLean(recognize.lean(here));
  };

  const up = () => {
    const action = recognize.up();
    if (onLean) onLean(0);
    if (action) onAction(action, recognize.grade());
  };

  const samplePointer = (event: PointerEvent) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    const coalesced = event.getCoalescedEvents?.() ?? [event];
    for (const entry of coalesced) {
      recognize.sample({ x: entry.clientX, y: entry.clientY }, entry.timeStamp);
    }
  };

  el.addEventListener("pointerdown", samplePointer);
  el.addEventListener("pointermove", samplePointer);
  el.addEventListener("touchstart", down, { passive: true });
  el.addEventListener("touchmove", move, { passive: false });
  el.addEventListener("touchend", up);
  el.addEventListener("touchcancel", up);
  return () => {
    el.removeEventListener("pointerdown", samplePointer);
    el.removeEventListener("pointermove", samplePointer);
    el.removeEventListener("touchstart", down);
    el.removeEventListener("touchmove", move);
    el.removeEventListener("touchend", up);
    el.removeEventListener("touchcancel", up);
  };
}
