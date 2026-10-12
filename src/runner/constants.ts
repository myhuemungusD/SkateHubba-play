import type { Lane } from "./types";

export const LANES: readonly Lane[] = [0, 1, 2];

/** World X of each lane. Negative X is the skater's left. */
export const LANE_X: readonly [number, number, number] = [-1.7, 0, 1.7];

export const BASE_SPEED = 14;
export const MAX_SPEED = 26;
/** Speed added per second. */
export const SPEED_RAMP = 0.4;
/** How fast the visual body slides into the committed lane. */
export const LANE_SLIDE = 16;

export const OLLIE_DURATION = 0.55;
export const OLLIE_PEAK = 1.35;
export const DUCK_DURATION = 0.6;

/** Height that clears a cone. Standing and ducking stay under this. */
export const CONE_CLEAR_Y = 0.55;
/** Above this, a rail will not grab the board. */
export const RAIL_LOCK_Y = 0.4;
export const RAIL_Y = 0.18;
export const RAIL_LENGTH = 8;
export const BOARDSLIDE_BONUS = 250;

export const FIRST_ROW_Z = 32;
export const ROW_GAP = 18;
export const SPAWN_AHEAD = 90;
export const SEGMENT_LENGTH = 40;

/** Largest slice the sim will take, so a hitch cannot tunnel through a cone. */
export const MAX_FRAME_DT = 0.05;

export const TRICK_BOARDSLIDE = "BOARDSLIDE";
