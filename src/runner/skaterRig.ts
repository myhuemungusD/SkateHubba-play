import type { RunnerState } from "./types";

/**
 * Drop-in contract for the founder's skater (Mike White reference).
 *
 * Phase 1 draws boxes. To switch on the real skater:
 *   1. Put the file at `public/runner/skater.glb`.
 *   2. Set `SKATER_GLTF_URL` below to `"/runner/skater.glb"`.
 *   3. Leave clip and node names exactly as listed. Missing clips are skipped.
 *
 * Model space:
 *   - Feet at the origin, +Y up, face toward -Z (down the street, away from the camera).
 *   - About 1.6 units tall. If the file is in centimeters, set `SKATER_GLTF_SCALE`.
 *   - In-place clips only. The runner owns translation. Root motion will skate off the lane.
 *   - One skeleton under a root node named `Skater`. A separate `Board` node
 *     (not required to be skinned) sits under that root.
 *   - Bone names are the Mixamo set so a Mixamo or commissioned export drops in:
 *     Hips, Spine, Spine1, Spine2, Neck, Head,
 *     LeftShoulder, LeftArm, LeftForeArm, LeftHand,
 *     RightShoulder, RightArm, RightForeArm, RightHand,
 *     LeftUpLeg, LeftLeg, LeftFoot, LeftToeBase,
 *     RightUpLeg, RightLeg, RightFoot, RightToeBase.
 */
export const SKATER_GLTF_URL: string | null = null;

/** Uniform scale applied to the glTF root. 1 matches a 1.6-unit-tall file. */
export const SKATER_GLTF_SCALE = 1;

export const SKATER_ROOT_NAME = "Skater";
export const SKATER_BOARD_NODE = "Board";

/** Exact animation clip names inside the glTF. */
export const SKATER_CLIPS = {
  idle: "Idle",
  push: "Push",
  ollie: "Ollie",
  powerslide: "Powerslide",
  boardslide: "Boardslide",
  bail: "Bail",
} as const;

export const SKATER_BONES = [
  "Hips",
  "Spine",
  "Spine1",
  "Spine2",
  "Neck",
  "Head",
  "LeftShoulder",
  "LeftArm",
  "LeftForeArm",
  "LeftHand",
  "RightShoulder",
  "RightArm",
  "RightForeArm",
  "RightHand",
  "LeftUpLeg",
  "LeftLeg",
  "LeftFoot",
  "LeftToeBase",
  "RightUpLeg",
  "RightLeg",
  "RightFoot",
  "RightToeBase",
] as const;

export type SkaterPose = "ride" | "ollie" | "duck" | "boardslide" | "bail";

export function poseFromState(state: RunnerState): SkaterPose {
  if (state.status === "gameover") return "bail";
  if (state.onRail) return "boardslide";
  if (state.duck >= 0) return "duck";
  if (state.ollie >= 0) return "ollie";
  return "ride";
}

/** Clip the glTF player should be on for this pose. Push covers the cruise. */
export function clipForPose(pose: SkaterPose): string {
  switch (pose) {
    case "ride":
      return SKATER_CLIPS.push;
    case "ollie":
      return SKATER_CLIPS.ollie;
    case "duck":
      return SKATER_CLIPS.powerslide;
    case "boardslide":
      return SKATER_CLIPS.boardslide;
    case "bail":
      return SKATER_CLIPS.bail;
    default: {
      const neverPose: never = pose;
      return neverPose;
    }
  }
}
