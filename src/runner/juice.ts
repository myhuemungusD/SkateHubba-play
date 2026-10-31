import type { Grade } from "./types";

/** Speed lines start just above the cruise speed. Max speed is 9, so a gate above that never draws. */
const SPEED_LINE_START = 6.6;

export function speedLineOpacity(speed: number, reducedMotion: boolean, playing: boolean): number {
  if (reducedMotion || !playing || speed <= SPEED_LINE_START) return 0;
  return Math.min(0.22, (speed - SPEED_LINE_START) / 12);
}

/** A puff when a grind ends. Reduced motion and a paused run stay clean. */
export function shouldPuffDust(
  wasOnGrind: boolean,
  onGrind: boolean,
  reducedMotion: boolean,
  playing: boolean,
): boolean {
  return wasOnGrind && !onGrind && !reducedMotion && playing;
}

const PERFECT_SHAKE_SECONDS = 0.28;
const PERFECT_SHAKE_AMP = 0.04;

export interface ShakeClock {
  left: number;
  phase: number;
}

export function emptyShake(): ShakeClock {
  return { left: 0, phase: 0 };
}

/**
 * A short offset added on top of the chase camera when a perfect grind locks.
 * Zero for every other frame, including reduced motion, so the base camera
 * stays put.
 */
export function stepPerfectShake(
  clock: ShakeClock,
  input: {
    onGrind: boolean;
    wasOnGrind: boolean;
    grade: Grade | null;
    reducedMotion: boolean;
  },
  dt: number,
): { x: number; y: number } {
  const start = !input.wasOnGrind && input.onGrind && input.grade === "perfect" && !input.reducedMotion;
  if (start) {
    clock.left = PERFECT_SHAKE_SECONDS;
    clock.phase = clock.phase === 0 ? 1 : 0;
  }
  if (clock.left <= 0 || input.reducedMotion) {
    clock.left = 0;
    return { x: 0, y: 0 };
  }
  clock.left = Math.max(0, clock.left - dt);
  const fade = clock.left / PERFECT_SHAKE_SECONDS;
  const amp = PERFECT_SHAKE_AMP * fade * fade;
  if (amp === 0) return { x: 0, y: 0 };
  const sign = clock.phase === 0 ? 1 : -1;
  return { x: sign * amp, y: sign * amp * 0.6 };
}
