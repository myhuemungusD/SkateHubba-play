import type { Grade, Lane, Trick } from "./types";

/**
 * Every number that changes how Skate Runner feels lives here.
 * The research brief's starting values are named below. Which ones the sim
 * actually runs is written up in docs/RUNNER_PHYSICS.md.
 * The sim steps at FIXED_DT. The screen only interpolates between those steps.
 */

/** Fixed physics step. 1/60, then the view blends between steps. */
export const FIXED_DT = 1 / 60;

/**
 * Largest slice the render loop will feed the sim after a hitch.
 * `stepRun` also refuses a bigger slice, so a lip cannot be skipped.
 */
export const MAX_FRAME_DT = 0.1;

/** How long a grind gesture is kept if it arrives before the lock, or during the freeze. */
export const GRIND_BUFFER = 0.15;

/** How long an ollie or land-press is kept before the wheels meet the ground. */
export const TRICK_BUFFER = 0.12;

/** Rejected trick taps retry for the grind buffer, the longer of the two windows. */
export const INPUT_BUFFER = GRIND_BUFFER;

/**
 * Extra time after the late window where a tap still locks, and after a
 * rail ends where a tap still counts as a pop. 100 ms.
 */
export const COYOTE_TIME = 0.1;

export const LANES: readonly Lane[] = [0, 1, 2];

export const LANE_X: readonly [number, number, number] = [-1.7, 0, 1.7];

/**
 * Cruise. Round 2 started at 8.5. This stays at 6 and climbs gently to 9
 * so a lip is readable. Grind drag pulls speed down while you are locked.
 */
export const BASE_SPEED = 6;
export const MAX_SPEED = 9;
export const SPEED_RAMP = 0.03;

/**
 * Seconds to slide one lane. Acceleration comes from that time and the gap,
 * so the board eases over instead of teleporting. 0.16s is a phone swipe
 * that still finishes before the next rail, a little heavier than 0.14s.
 */
export const LANE_TWEEN = 0.16;
export const LANE_ACCEL = (2 * (LANE_X[1] - LANE_X[0])) / (LANE_TWEEN * LANE_TWEEN);
/** Kept for older notes. The slide is acceleration, not a constant speed. */
export const LANE_SLIDE = 14;

/**
 * Closed-form ollie. Apex h and air time T give g = 8h/T² and v0 = 4h/T.
 * The way down uses FALL_GRAVITY_SCALE so the landing snaps.
 * 0.58s keeps the 1.1m apex and brings the board back sooner, closer to a
 * skate pop than a floaty hop.
 */
export const OLLIE_HEIGHT = 1.1;
export const OLLIE_AIRTIME = 0.58;
export const OLLIE_GRAVITY = (8 * OLLIE_HEIGHT) / (OLLIE_AIRTIME * OLLIE_AIRTIME);
export const OLLIE_POP = (4 * OLLIE_HEIGHT) / OLLIE_AIRTIME;
export const GRAVITY = OLLIE_GRAVITY;
export const FALL_GRAVITY_SCALE = 1.6;
/** Nose-up angular speed (radians/sec) on the pop. Positive pitch lifts the nose. */
export const POP_NOSE = 7.5;
/** Seconds the nose stays up before the spring levels the board for the landing. */
export const POP_HOLD = 0.14;
export const PITCH_HOLD_DAMP = 1.4;

/** Pull toward level. High spring, a bit under critical damping, so it settles. */
export const ANGULAR_SPRING = 70;
export const ANGULAR_DAMP = 13;

/** A slow flick is this fraction of a full pop. A score of 5 is the full ollie. */
export const FLICK_POP_MIN = 0.62;

/** Landing compression and the small rebound. */
export const SQUASH_GAIN = 0.055;
export const SQUASH_MAX = 0.2;
export const BOUNCE = 0.22;
export const BOUNCE_STOP = 0.85;
export const SQUASH_RECOVER = 1.6;

export const DUCK_DURATION = 0.6;
/** Fraction of speed a powerslide sheds, once, when it starts. */
export const POWERSLIDE_SHED = 0.3;
export const FLIP_DURATION = 0.38;
/** The roll waits this long after the pop, then eases out. */
export const FLIP_DELAY = 0.05;
/** A kickflip may finish this long after the lock and still blend out. */
export const FLIP_LOCK_BLEND = 0.08;
/** Extra roll left in the air when a flick scores 1 for accuracy. 5 leaves none. */
export const FLIP_SLOP = 0.55;
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
/** Seconds to ease onto the rail. 90ms lets the trucks settle instead of teleporting. */
export const MAGNET_SNAP = 0.09;
/** Older pull rate. The snap time above is what the sim uses. */
export const MAGNET_PULL = 1 / MAGNET_SNAP;

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
 * Balance acceleration is k·θ + noise. k starts here and grows 15% per
 * repeated grind. The first half-second on a rail does not drift.
 * A grind has to last longer than BALANCE_ACTIVE_AFTER before a dump bails,
 * so a short street rail still lets you off clean.
 */
export const BALANCE_K0 = 1.5;
export const BALANCE_REPEAT = 0.15;
export const BALANCE_NOISE = 0.3;
export const BALANCE_FREE = 0.5;
export const BALANCE_ACTIVE_AFTER = 3;
export const BALANCE_LIMIT = 1;
export const BALANCE_NUDGE = 0.38;
/** Sign of the noise. Even seeds drift left. */
export const BALANCE_DRIFT = 1;
/** Older linear walk. The acceleration above replaced it. */
export const BALANCE_RAMP = 0.15;
export const BALANCE_GRACE = BALANCE_FREE;
/** How fast a held finger or key pulls balance, at full deflection. */
export const LEAN_RATE = 1.15;
/** Finger travel, in pixels, that counts as full balance deflection. */
export const LEAN_PX = 110;

/** Lock-in freeze, perfect-landing freeze, and crash freeze. Never longer than the max. */
export const HIT_STOP = 0.05;
export const HIT_STOP_PERFECT = 0.07;
export const HIT_STOP_BAIL = 0.12;
export const HIT_STOP_MAX = 0.15;

/** Touchdown angle. 10° is perfect, 25° is clean, past 50° bails. */
export const LAND_PERFECT = (10 * Math.PI) / 180;
export const LAND_CLEAN = (25 * Math.PI) / 180;
export const LAND_BAIL = (50 * Math.PI) / 180;
/** Flip progress required before a landing can be perfect. */
export const FLIP_COMPLETE = 0.95;
/** A land-press this close to the wheels touching upgrades the landing. */
export const LAND_PRESS_WINDOW = 0.08;
/** Speed added when that press lands in the window. */
export const LAND_PRESS_BOOST = 0.35;
/** The board levels itself over this long, at the end of the descent. */
export const LAND_LEVEL_WINDOW = 0.12;
export const AUTOLEVEL_SPRING = 220;

export const RIDE_PITCH = 0.03;

/** Crooked: nose on the rail, yaw inside 15–35°, one truck down. */
export const CROOKED_PITCH = -0.28;
export const CROOKED_YAW = (32 * Math.PI) / 180;
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
/** Pop and land pitch wander by this fraction so two pops are not identical. */
export const PITCH_JITTER = 0.05;

/**
 * Layered loops. Roll follows speed while the wheels are down. Grind replaces
 * it on a lock. A powerslide is the quieter scrape. Pop and land stay one-shots.
 * Gains are linear from cruise speed to the cap. Rates are playbackRate.
 */
export const ROLL_GAIN_LO = 0.07;
export const ROLL_GAIN_HI = 0.18;
export const ROLL_RATE_LO = 0.86;
export const ROLL_RATE_HI = 1.24;
export const GRIND_GAIN_LO = 0.2;
export const GRIND_GAIN_HI = 0.32;
export const GRIND_RATE_LO = 0.94;
export const GRIND_RATE_HI = 1.16;
export const SCRAPE_GAIN = 0.11;
export const SCRAPE_RATE = 0.78;
/** How fast the loops chase a new mix, in 1/seconds. */
export const MIX_RESPONSE = 14;

/** One haptic at a time. A grind ticks a light pulse on this interval. */
export const HAPTIC_GAP_MS = 50;
export const GRIND_PULSE = 0.12;

/** Flick-It style scores are 1–5. Sensitivity 50 is the default swipe distance. */
export const FLICK_SCORE_MIN = 1;
export const FLICK_SCORE_MAX = 5;
export const FLICK_SENSITIVITY = 50;

/**
 * Starting numbers from the brief that this lane runner does not run.
 * The camera, the rail mesh height, and adjacent-lane grabs stayed as they
 * were. docs/RUNNER_PHYSICS.md says why.
 */
export const SUGGESTED = {
  rapierFrameClamp: 0.5,
  commonFrameClamp: 0.25,
  railHeightMin: 0.6,
  railHeightMax: 0.9,
  magnetRadius: 0.35,
  magnetBand: 0.25,
  laneAssist: 1,
  cameraX: 0,
  cameraY: 2.2,
  cameraZ: 4.5,
  lookAhead: 6,
  cameraOmega: 8,
  laneOmega: 5,
  grindCameraDrop: 0.3,
  grindFov: 4,
  speedFov: 8,
  traumaLand: 0.25,
  traumaBail: 0.6,
  grindCrossfade: 0.04,
} as const;

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
