import { FLIP_DURATION } from "./constants";
import type { RunnerState } from "./types";

/**
 * The player is a skateboard. There is no skater mesh.
 *
 * `boardPose` is the whole animation. A later art pass can parent a glTF
 * under the posed group and hide the procedural meshes. Node names the
 * procedural board already uses, if that file wants to match them:
 * Deck, Griptape, Graphic, TruckNose, TruckTail,
 * WheelNoseLeft, WheelNoseRight, WheelTailLeft, WheelTailRight.
 *
 * The root sits with its nose toward -Z (down the street). Pitch, yaw, and
 * roll are radians on that root. `spin` is an extra 0..1 kickflip turn.
 * The runner code moves the group. Do not bake root motion into a file.
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
  /** 0..1, one full kickflip. */
  spin: number;
}

export function boardPose(state: RunnerState): BoardPose {
  if (state.status === "gameover") {
    return { pitch: 0.8, yaw: 0.4, roll: 1.2, y: 0.05, spin: 0 };
  }
  if (state.onGrind && state.grindTrick === "nose") {
    return { pitch: -0.75, yaw: 0.08, roll: 0.12, y: state.y, spin: 0 };
  }
  if (state.onGrind) {
    return { pitch: 0.02, yaw: 0.62, roll: 0.48, y: state.y, spin: 0 };
  }
  if (state.flip >= 0) {
    const spin = Math.min(1, state.flip / FLIP_DURATION);
    return { pitch: 0.12, yaw: 0.05, roll: 0, y: Math.sin(spin * Math.PI) * 0.45, spin };
  }
  if (state.duck >= 0) {
    return { pitch: 0.04, yaw: 0.85, roll: -0.18, y: 0, spin: 0 };
  }
  return { pitch: 0.03, yaw: 0, roll: 0, y: 0, spin: 0 };
}
