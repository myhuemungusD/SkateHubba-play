import type { Grade, Lane, Trick } from "./types";

export const LANES: readonly Lane[] = [0, 1, 2];

/** World X of each lane. Negative X is the board's left. */
export const LANE_X: readonly [number, number, number] = [-1.7, 0, 1.7];

/**
 * Round 2 cruised at 8.5 and added 0.06 each second up to 13.
 * This pass starts about 30% slower (6) and climbs at half that rate up to 9,
 * so a lip stays readable while the camera shows the rails ahead.
 */
export const BASE_SPEED = 6;
export const MAX_SPEED = 9;
/** Speed added per second. */
export const SPEED_RAMP = 0.03;
/** How fast the visual board slides into the committed lane. */
export const LANE_SLIDE = 14;

export const DUCK_DURATION = 0.5;
export const FLIP_DURATION = 0.38;
/** Second tap inside this window upgrades a crooked grind to a nose slide. */
export const DOUBLE_TAP = 0.28;

/**
 * How far before the lip an armed trick still counts.
 * At the starting speed that is about a second and a quarter.
 * The bands are a little wider than round 2 so the slower approach still
 * has a readable perfect, good, and sloppy.
 */
export const ARM_RANGE = 7.5;
/** How far past the lip a late make still locks. Later than this, the input bails. */
export const LATE_LOCK = 2.5;

/** Lead (units armed before the lip) for a perfect make. */
export const PERFECT_MIN = 0.38;
export const PERFECT_MAX = 2.8;
/** Lead that is still clean, outside the perfect band. */
export const GOOD_MAX = 5.1;

export const RAIL_Y = 0.3;
export const BOX_Y = 0.34;
export const RAIL_LENGTH = 7;
export const BOX_LENGTH = 3.6;

export const FIRST_ROW_Z = 24;
export const ROW_GAP = 22;
export const SPAWN_AHEAD = 72;
export const SEGMENT_LENGTH = 40;

/** Largest slice the sim will take, so a hitch cannot skip a lip. */
export const MAX_FRAME_DT = 0.05;

/** Passed features in your lane before the run ends. */
export const MISS_LIMIT = 3;

export const COMBO_STEP = 0.5;
export const COMBO_CAP = 5;

export const TRICK_NAMES: Record<Trick, string> = {
  crooked: "CROOKED GRIND",
  nose: "NOSE SLIDE",
  kickflip: "KICKFLIP CROOKED",
};

export const ARM_LABELS: Record<Trick, string> = {
  crooked: "CROOKED",
  nose: "NOSE SLIDE",
  kickflip: "KICKFLIP",
};

export const TRICK_POINTS: Record<Trick, Record<Grade, number>> = {
  crooked: { perfect: 400, good: 250, sloppy: 80 },
  nose: { perfect: 650, good: 400, sloppy: 120 },
  kickflip: { perfect: 1000, good: 600, sloppy: 180 },
};

export const TRICK_POWERSLIDE = "POWERSLIDE";

/** Chain length includes the make about to score. 1 is x1, 2 is x1.5, capped at x5. */
export function multiplierFor(combo: number): number {
  if (combo <= 1) return 1;
  return Math.min(COMBO_CAP, 1 + (combo - 1) * COMBO_STEP);
}
