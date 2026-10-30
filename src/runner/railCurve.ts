import { BOX_Y, COPING_OFFSET, LANE_X, RAIL_BOW, RAIL_Y, GRIND_DIR_DOT } from "./tune";
import type { Obstacle } from "./types";

export interface CurveSample {
  x: number;
  y: number;
  /** Unit tangent. +z is down the street. */
  tx: number;
  tz: number;
}

/** 0 at the near lip, 1 at the far end. */
function railAlong(along: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(1, Math.max(0, along / length));
}

/** Lateral offset of a bowed rail. Zero at both ends. */
export function railBowOffset(alongUnit: number, bow = RAIL_BOW): number {
  return Math.sin(Math.PI * Math.min(1, Math.max(0, alongUnit))) * bow;
}

/**
 * Point and tangent on a grind. A rail bows sideways. A ledge stays straight
 * and sits on the coping edge, not the middle of the box.
 */
export function curveSample(obstacle: Obstacle, along: number): CurveSample {
  const laneX = LANE_X[obstacle.lane];
  const unit = railAlong(along, obstacle.length);
  if (obstacle.kind === "box") {
    return { x: laneX + COPING_OFFSET, y: BOX_Y, tx: 0, tz: 1 };
  }
  const dx = obstacle.length <= 0 ? 0 : ((Math.PI * RAIL_BOW) / obstacle.length) * Math.cos(Math.PI * unit);
  const dz = 1;
  const span = Math.hypot(dx, dz);
  return {
    x: laneX + railBowOffset(unit),
    y: RAIL_Y,
    tx: dx / span,
    tz: dz / span,
  };
}

/** True when the board is heading along the rail, not across it or back up it. */
export function grindDirectionOk(vx: number, speed: number, tx: number, tz: number): boolean {
  const span = Math.hypot(vx, speed);
  if (span < 1e-6) return true;
  return (vx * tx + speed * tz) / span >= GRIND_DIR_DOT;
}
