import { FLIP_DELAY, FLIP_DURATION, FLIP_LOCK_BLEND } from "./constants";
import { trickAngles } from "./physics";
import type { RunnerState } from "./types";

/**
 * The player is a skateboard. There is no skater mesh.
 *
 * Pitch lifts the nose (a pop pivots the tail). Roll is the long axis,
 * and `spin` is the kickflip turn on that same axis. Yaw is the shove-it
 * angle: crooked sits between a shove and straight, a nose slide is 90 degrees.
 *
 * The root sits with its nose toward -Z (down the street). The runner code
 * moves the group. Do not bake root motion into a file.
 */
export const BOARD_NODES = [
  "Deck",
  "Griptape",
  "Graphic",
  "TruckNose",
  "TruckTail",
  "WheelNoseLeft",
  "WheelNoseRight",
  "WheelTailLeft",
  "WheelTailRight",
] as const;

export interface BoardPose {
  pitch: number;
  yaw: number;
  roll: number;
  y: number;
  /** 0..1, one full kickflip, added on the roll axis. */
  spin: number;
}

function easeOut(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return 1 - (1 - u) ** 3;
}

/** One roll around the board's length. It waits out the pop, then eases off. */
export function flipSpin(flip: number): number {
  if (flip <= FLIP_DELAY) return 0;
  return easeOut((flip - FLIP_DELAY) / (FLIP_DURATION - FLIP_DELAY));
}

export function boardPose(state: RunnerState): BoardPose {
  if (state.status === "gameover" || state.crashed) {
    return { pitch: 0.8, yaw: 0.4, roll: 1.2, y: 0.05, spin: 0 };
  }
  if (state.onGrind && state.grindTrick) {
    const angles = trickAngles(state.grindTrick);
    const spin = state.flipBlend > 0 ? flipSpin(state.flip) * (state.flipBlend / FLIP_LOCK_BLEND) : 0;
    return { ...angles, y: state.y, spin };
  }
  if (state.flip >= 0) {
    return { pitch: state.pitch, yaw: state.yaw, roll: state.roll, y: state.y, spin: flipSpin(state.flip) };
  }
  if (state.duck >= 0) {
    return { pitch: 0.04, yaw: 0.85, roll: -0.18, y: 0, spin: 0 };
  }
  return { pitch: state.pitch, yaw: state.yaw, roll: state.roll, y: state.y, spin: 0 };
}
