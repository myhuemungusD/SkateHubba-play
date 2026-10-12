import type { Grade, Lane, Trick } from "./types";

/**
 * Every number that changes how Skate Runner feels lives here.
 * Speed, ollie height, grind drag, balance, landing windows, juice.
 * The sim steps at FIXED_DT. The screen only interpolates between those steps.
 */

/** Fixed physics step. 120Hz, then the view blends between steps at 60fps. */
export const FIXED_DT = 1 / 120;

/** Largest slice one `stepRun` call will take. A hitch cannot skip a lip. */
export const MAX_FRAME_DT = 0.05;

/** How long a rejected trick tap is retried. Taps during the lock freeze still count. */
export const INPUT_BUFFER = 0.14;

/**
 * Extra time after the late window where a tap still locks.
 * Fairness for a finger that was a beat late, not a second late.
 */
export const COYOTE_TIME = 0.12;

export const LANES: readonly Lane[] = [0, 1, 2];

export const LANE_X: readonly [number, number, number] = [-1.7, 0, 1.7];

/**
 * Cruise. Round 2 started at 8.5. This stays at 6 and climbs gently to 9
 * so a lip is readable. Grind drag pulls speed down while you are locked.
 */
export const BASE_SPEED = 6;
export const MAX_SPEED = 9;
export const SPEED_RAMP = 0.03;

/** Lateral acceleration toward the committed lane. The board has inertia. */
export const LANE_ACCEL = 120;
/** Kept for older notes. The slide is acceleration, not a constant speed. */
export const LANE_SLIDE = 14;

/** Upward speed of a pop. Airtime is about 2 * pop / gravity, plus hang. */
export const OLLIE_POP = 3.35;
/** Nose-up angular speed (radians/sec) on the pop. Positive pitch lifts the nose. */
export const POP_NOSE = 7.5;
/** Seconds the nose stays up before the spring levels the board for the landing. */
export const POP_HOLD = 0.11;
export const PITCH_HOLD_DAMP = 1.4;

/** Pull toward level. High spring, a bit under critical damping, so it settles. */
export const ANGULAR_SPRING = 70;
export const ANGULAR_DAMP = 13;

/** World gravity. Hang time scales it down while vertical speed is near zero. */
export const GRAVITY = 16.5;
export const HANG_SPEED = 1.15;
export const HANG_SCALE = 0.42;

/** Landing compression and the small rebound. */
export const SQUASH_GAIN = 0.055;
export const SQUASH_MAX = 0.2;
export const BOUNCE = 0.22;
export const BOUNCE_STOP = 0.85;
export const SQUASH_RECOVER = 1.6;

export const DUCK_DURATION = 0.5;
export const FLIP_DURATION = 0.38;
/** Second tap inside this window upgrades a crooked grind to a nose slide. */
export const DOUBLE_TAP = 0.28;

/** How far before the lip an armed trick still counts. */
export const ARM_RANGE = 7.5;
/** How far past the lip a late make still locks, before coyote time is added. */
export const LATE_LOCK = 2.5;

/** Lead (units armed before the lip) for a perfect make. */
export const PERFECT_MIN = 0.38;
export const PERFECT_MAX = 2.8;
/** Lead that is still clean, outside the perfect band. */
export const GOOD_MAX = 5.1;

/** How far before the lip the board starts easing onto the feature. */
export const MAGNET_LEAD = 1.35;
export const MAGNET_PULL = 9;

export const RAIL_Y = 0.3;
export const BOX_Y = 0.34;
export const RAIL_LENGTH = 7;
export const BOX_LENGTH = 3.6;

/** Speed lost per second while locked. The board keeps a floor so the rail ends. */
export const GRIND_DRAG = 1.15;
export const GRIND_MIN_SPEED = 3.4;

/** Pop off the end, or off a tap during the grind. */
export const EXIT_POP = 2.7;
/** A tap in the first part of the feature is an early pop and cannot land perfect. */
export const EXIT_EARLY = 0.45;

/**
 * Balance walks this far per second at the start of a run.
 * It grows with elapsed time, so later grinds ask for a correction.
 * 1 is the bail line.
 */
export const BALANCE_DRIFT = 0.22;
export const BALANCE_RAMP = 0.04;
export const BALANCE_LIMIT = 1;
export const BALANCE_NUDGE = 0.38;
/** Seconds after the lock before a bad balance can dump you. */
export const BALANCE_GRACE = 0.35;
/** How fast a held finger or key pulls balance, at full deflection. */
export const LEAN_RATE = 1.15;
/** Finger travel, in pixels, that counts as full balance deflection. */
export const LEAN_PX = 110;

/** Lock-in freeze. Perfect is a hair longer. The view holds because the sim holds. */
export const HIT_STOP = 0.04;
export const HIT_STOP_PERFECT = 0.06;

/** Touchdown angle (radians) and balance for the landing grade. */
export const LAND_PERFECT = 0.22;
export const LAND_CLEAN = 0.9;
export const LAND_BAIL = 1.25;

export const RIDE_PITCH = 0.03;

/** Crooked: nose on the rail, board yawed, one truck down. */
export const CROOKED_PITCH = -0.28;
export const CROOKED_YAW = 0.62;
export const CROOKED_ROLL = 0.5;

/** Nose slide: board across the ledge, nose down on it. Yaw is 90 degrees. */
export const NOSE_PITCH = -1.15;
export const NOSE_YAW = Math.PI / 2;
export const NOSE_ROLL = 0.06;

export const FIRST_ROW_Z = 24;
export const ROW_GAP = 22;
export const SPAWN_AHEAD = 72;
export const SEGMENT_LENGTH = 40;

/** Passed features in your lane before the run ends. */
export const MISS_LIMIT = 3;

export const COMBO_STEP = 0.5;
export const COMBO_CAP = 5;

/** Meters between ghost samples. The best line stays on this device only. */
export const GHOST_SPACING = 0.5;

export const SFX_VOLUME = 0.4;

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
  crooked: { perfect: 400, clean: 250, sketchy: 80 },
  nose: { perfect: 650, clean: 400, sketchy: 120 },
  kickflip: { perfect: 1000, clean: 600, sketchy: 180 },
};

/** Added when the wheels come back down. A bail pays nothing. */
export const LANDING_BONUS: Record<Grade, number> = {
  perfect: 150,
  clean: 80,
  sketchy: 20,
};

export const TRICK_POWERSLIDE = "POWERSLIDE";

/** Chain length includes the make about to score. 1 is x1, 2 is x1.5, capped at x5. */
export function multiplierFor(combo: number): number {
  if (combo <= 1) return 1;
  return Math.min(COMBO_CAP, 1 + (combo - 1) * COMBO_STEP);
}

export function coyoteDistance(speed: number): number {
  return Math.max(0, speed) * COYOTE_TIME;
}
