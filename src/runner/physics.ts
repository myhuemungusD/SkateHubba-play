import {
  ANGULAR_DAMP,
  ANGULAR_SPRING,
  AUTOLEVEL_SPRING,
  BALANCE_ACTIVE_AFTER,
  BALANCE_FREE,
  BALANCE_K0,
  BALANCE_LIMIT,
  BALANCE_NOISE,
  BALANCE_REPEAT,
  BOUNCE,
  BOUNCE_STOP,
  CROOKED_PITCH,
  CROOKED_ROLL,
  CROOKED_YAW,
  FALL_GRAVITY_SCALE,
  FLICK_POP_MIN,
  FLIP_COMPLETE,
  LAND_BAIL,
  LAND_CLEAN,
  LAND_LEVEL_WINDOW,
  LAND_PERFECT,
  LANE_ACCEL,
  LANE_X,
  LATE_LOCK,
  MAGNET_SNAP,
  magnetLeadFor,
  magnetRadiusFor,
  NOSE_PITCH,
  NOSE_ROLL,
  NOSE_YAW,
  OLLIE_GRAVITY,
  PITCH_HOLD_DAMP,
  POP_HOLD,
  RIDE_PITCH,
  SQUASH_GAIN,
  SQUASH_MAX,
  SQUASH_RECOVER,
} from "./tune";
import { curveSample } from "./railCurve";
import type { Grade, RunnerState, Trick } from "./types";

export interface BoardAngles {
  pitch: number;
  yaw: number;
  roll: number;
}

export interface LandingSample {
  pitch: number;
  yaw: number;
  roll: number;
  balance: number;
  popped: boolean;
  earlyPop: boolean;
  /** 0..1. A trick that was not a flip is already complete. */
  flipComplete: number;
}

export interface MotionResult {
  /** The wheels met the ground this step. */
  touched: boolean;
}

export function trickAngles(trick: Trick): BoardAngles {
  if (trick === "nose") return { pitch: NOSE_PITCH, yaw: NOSE_YAW, roll: NOSE_ROLL };
  return { pitch: CROOKED_PITCH, yaw: CROOKED_YAW, roll: CROOKED_ROLL };
}

/** How far the board is from a flat landing. Yaw counts less than pitch and roll. */
function landingAngle(sample: LandingSample): number {
  const pitch = Math.abs(sample.pitch - RIDE_PITCH);
  const roll = Math.abs(sample.roll);
  const yaw = Math.abs(sample.yaw) * 0.35;
  return Math.max(pitch, roll, yaw);
}

/** 1 is a short pop. 5 is the full ollie. */
export function popScale(speed: number): number {
  const score = Math.max(1, Math.min(5, speed));
  return FLICK_POP_MIN + ((score - 1) / 4) * (1 - FLICK_POP_MIN);
}

/** Height and vertical speed of a pop at time t. Up uses g, down uses the fall scale. */
export function ollieArc(t: number, v0: number, fallScale = FALL_GRAVITY_SCALE): { y: number; vy: number } {
  const gUp = OLLIE_GRAVITY;
  const apexAt = v0 / gUp;
  if (t <= apexAt) {
    return { y: v0 * t - 0.5 * gUp * t * t, vy: v0 - gUp * t };
  }
  const height = (v0 * v0) / (2 * gUp);
  const fall = t - apexAt;
  const gDown = gUp * fallScale;
  return { y: height - 0.5 * gDown * fall * fall, vy: -gDown * fall };
}

function fallOf(state: RunnerState): number {
  return state.fallScale > 0 ? state.fallScale : FALL_GRAVITY_SCALE;
}

/** Seconds until the wheels meet the ground. Large when the board is still rising. */
export function timeToGround(state: RunnerState): number {
  if (state.y <= 0 && !state.airborne) return 0;
  if (state.popV0 > 0) {
    const gUp = OLLIE_GRAVITY;
    const apexAt = state.popV0 / gUp;
    const height = (state.popV0 * state.popV0) / (2 * gUp);
    const gDown = gUp * fallOf(state);
    const total = apexAt + Math.sqrt((2 * height) / gDown);
    return Math.max(0, total - state.popAge);
  }
  if (state.vy >= 0) return 1;
  const g = OLLIE_GRAVITY * fallOf(state);
  const disc = state.vy * state.vy + 2 * g * Math.max(0, state.y);
  return Math.max(0, (state.vy + Math.sqrt(disc)) / g);
}

/**
 * Perfect needs a late pop, a flat board, a finished flip, and a centered balance.
 * Sliding off the end is a clean exit. A wild angle or a dumped balance bails.
 */
export function gradeTouchdown(sample: LandingSample): Grade | "bail" {
  const angle = landingAngle(sample);
  if (angle > LAND_BAIL || Math.abs(sample.balance) > BALANCE_LIMIT) return "bail";
  if (!sample.popped) return "clean";
  const flipDone = sample.flipComplete >= FLIP_COMPLETE;
  if (!sample.earlyPop && flipDone && angle <= LAND_PERFECT && Math.abs(sample.balance) <= 0.35) {
    return "perfect";
  }
  if (angle <= LAND_CLEAN && Math.abs(sample.balance) <= 0.6) return "clean";
  return "sketchy";
}

/**
 * Needle acceleration a = k·θ + noise. k grows with time on the rail and
 * with each earlier grind in the combo. The first half-second is still.
 */
export function stepBalance(state: RunnerState, dt: number): void {
  if (!state.onGrind || state.grindTime < BALANCE_FREE) return;
  const repeats = Math.max(0, state.grinds - 1);
  const k = BALANCE_K0 * (1 + BALANCE_REPEAT * repeats) * (1 + state.grindTime / BALANCE_ACTIVE_AFTER);
  const accel = k * state.balance + state.balanceDrift * BALANCE_NOISE;
  state.balanceVel += accel * dt;
  state.balance += state.balanceVel * dt;
}

function spring(value: number, vel: number, target: number, dt: number, rate: number): { value: number; vel: number } {
  const accel = (target - value) * rate - vel * ANGULAR_DAMP * (rate > ANGULAR_SPRING ? 1.6 : 1);
  const nextVel = vel + accel * dt;
  return { value: value + nextVel * dt, vel: nextVel };
}

function featurePull(state: RunnerState): { x: number; y: number } | null {
  const leadLimit = magnetLeadFor(state.grindAssist);
  const radius = magnetRadiusFor(state.grindAssist);
  if (!state.armed || state.duck >= 0 || leadLimit <= 0 || radius <= 0) return null;
  let bestLead = leadLimit;
  let pull: { x: number; y: number } | null = null;
  for (const obstacle of state.obstacles) {
    if (obstacle.lane !== state.lane || obstacle.resolved || obstacle.awarded) continue;
    const lead = obstacle.z - state.distance;
    if (lead < -LATE_LOCK || lead > bestLead) continue;
    const sample = curveSample(obstacle, Math.max(0, -lead));
    if (Math.abs(state.y - sample.y) > radius) continue;
    bestLead = lead;
    pull = { x: sample.x, y: sample.y };
  }
  return pull;
}

/**
 * One physics slice. Mutates `state`.
 * Air is a closed-form arc. The lane change accelerates.
 * A grind pins the board. Landing squashes and can bounce.
 */
export function integrateMotion(state: RunnerState, dt: number): MotionResult {
  if (state.squash > 0) state.squash = Math.max(0, state.squash - SQUASH_RECOVER * dt);

  if (state.onGrind) {
    state.airborne = false;
    state.vy = 0;
    state.vx = 0;
    const pose = trickAngles(state.grindTrick ?? "crooked");
    state.pitch = pose.pitch;
    state.yaw = pose.yaw;
    state.roll = pose.roll;
    return { touched: false };
  }

  const target = LANE_X[state.lane];
  const dx = target - state.x;
  if (Math.abs(dx) < 0.008) {
    state.x = target;
    state.vx = 0;
  } else {
    state.vx += Math.sign(dx) * LANE_ACCEL * dt;
    const stop = Math.sqrt(2 * LANE_ACCEL * Math.abs(dx));
    if (state.vx > stop) state.vx = stop;
    if (state.vx < -stop) state.vx = -stop;
    const step = state.vx * dt;
    if (Math.abs(step) >= Math.abs(dx)) {
      state.x = target;
      state.vx = 0;
    } else {
      state.x += step;
    }
  }

  if (state.duck >= 0) {
    state.airborne = false;
    state.vy = 0;
    state.y = 0;
    state.pendingLanding = false;
    const pitched = spring(state.pitch, state.pitchVel, 0.04, dt, ANGULAR_SPRING);
    state.pitch = pitched.value;
    state.pitchVel = pitched.vel;
    return { touched: false };
  }

  state.popAge += dt;
  const leveling = state.airborne && state.vy < 0 && timeToGround(state) <= LAND_LEVEL_WINDOW;
  const springRate = leveling ? AUTOLEVEL_SPRING : ANGULAR_SPRING;
  if (state.airborne && state.popAge < POP_HOLD && !leveling) {
    state.pitch += state.pitchVel * dt;
    state.pitchVel *= Math.max(0, 1 - PITCH_HOLD_DAMP * dt);
  } else {
    const pitched = spring(state.pitch, state.pitchVel, RIDE_PITCH, dt, springRate);
    state.pitch = pitched.value;
    state.pitchVel = pitched.vel;
  }
  const rolled = spring(state.roll, state.rollVel, 0, dt, springRate);
  state.roll = rolled.value;
  state.rollVel = rolled.vel;
  const yawed = spring(state.yaw, state.yawVel, 0, dt, springRate);
  state.yaw = yawed.value;
  state.yawVel = yawed.vel;

  let touched = false;
  const magnet = featurePull(state);
  const fall = fallOf(state);
  if (!state.airborne) {
    state.vy = 0;
    state.popV0 = 0;
    if (magnet === null) state.y = 0;
  } else if (state.popV0 > 0) {
    const sample = ollieArc(state.popAge, state.popV0, fall);
    state.y = sample.y;
    state.vy = sample.vy;
    if (sample.y <= 0 && state.popAge > dt) {
      const impact = Math.max(0, -sample.vy);
      state.popV0 = 0;
      state.y = 0;
      state.squash = Math.min(SQUASH_MAX, impact * SQUASH_GAIN);
      const rebound = impact * BOUNCE;
      if (rebound < BOUNCE_STOP) {
        state.vy = 0;
        state.airborne = false;
      } else {
        state.vy = rebound;
        state.y = 0.001;
      }
      touched = true;
    }
  } else {
    state.vy -= OLLIE_GRAVITY * fall * dt;
    state.y += state.vy * dt;
    if (state.y <= 0) {
      const impact = Math.max(0, -state.vy);
      state.y = 0;
      state.squash = Math.min(SQUASH_MAX, impact * SQUASH_GAIN);
      const rebound = impact * BOUNCE;
      if (rebound < BOUNCE_STOP) {
        state.vy = 0;
        state.airborne = false;
      } else {
        state.vy = rebound;
      }
      touched = true;
    }
  }

  if (magnet !== null && !touched) {
    const pull = Math.min(1, dt / MAGNET_SNAP);
    state.y += (magnet.y - state.y) * pull;
    state.x += (magnet.x - state.x) * pull;
  }
  return { touched };
}
