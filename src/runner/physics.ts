import {
  ANGULAR_DAMP,
  ANGULAR_SPRING,
  BALANCE_LIMIT,
  BOUNCE,
  BOUNCE_STOP,
  CROOKED_PITCH,
  CROOKED_ROLL,
  CROOKED_YAW,
  GRAVITY,
  HANG_SCALE,
  HANG_SPEED,
  LAND_BAIL,
  LAND_CLEAN,
  LAND_PERFECT,
  LANE_ACCEL,
  LANE_X,
  MAGNET_LEAD,
  MAGNET_PULL,
  NOSE_PITCH,
  NOSE_ROLL,
  NOSE_YAW,
  PITCH_HOLD_DAMP,
  POP_HOLD,
  RAIL_Y,
  BOX_Y,
  RIDE_PITCH,
  SQUASH_GAIN,
  SQUASH_MAX,
  SQUASH_RECOVER,
  LATE_LOCK,
} from "./tune";
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
export function landingAngle(sample: LandingSample): number {
  const pitch = Math.abs(sample.pitch - RIDE_PITCH);
  const roll = Math.abs(sample.roll);
  const yaw = Math.abs(sample.yaw) * 0.35;
  return Math.max(pitch, roll, yaw);
}

/**
 * Perfect needs a late pop, a flat board, and a centered balance.
 * Sliding off the end can be clean. A wild angle or a dumped balance bails.
 */
export function gradeTouchdown(sample: LandingSample): Grade | "bail" {
  const angle = landingAngle(sample);
  if (angle > LAND_BAIL || Math.abs(sample.balance) > BALANCE_LIMIT) return "bail";
  if (sample.popped && !sample.earlyPop && angle <= LAND_PERFECT && Math.abs(sample.balance) <= 0.35) {
    return "perfect";
  }
  if (angle <= LAND_CLEAN && Math.abs(sample.balance) <= 0.6) return "clean";
  return "sketchy";
}

function spring(value: number, vel: number, target: number, dt: number): { value: number; vel: number } {
  const accel = (target - value) * ANGULAR_SPRING - vel * ANGULAR_DAMP;
  const nextVel = vel + accel * dt;
  return { value: value + nextVel * dt, vel: nextVel };
}

function featureHeight(state: RunnerState): number | null {
  if (!state.armed || state.duck >= 0) return null;
  let bestLead = MAGNET_LEAD;
  let height: number | null = null;
  for (const obstacle of state.obstacles) {
    if (obstacle.lane !== state.lane || obstacle.resolved || obstacle.awarded) continue;
    const lead = obstacle.z - state.distance;
    if (lead < -LATE_LOCK || lead > bestLead) continue;
    bestLead = lead;
    height = obstacle.kind === "rail" ? RAIL_Y : BOX_Y;
  }
  return height;
}

/**
 * One physics slice. Mutates `state`.
 * Air is a parabola with hang near the apex. The lane change accelerates.
 * A grind pins the board and walks the balance. Landing squashes and can bounce.
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
    const pitched = spring(state.pitch, state.pitchVel, 0.04, dt);
    state.pitch = pitched.value;
    state.pitchVel = pitched.vel;
    return { touched: false };
  }

  state.popAge += dt;
  if (state.airborne && state.popAge < POP_HOLD) {
    state.pitch += state.pitchVel * dt;
    state.pitchVel *= Math.max(0, 1 - PITCH_HOLD_DAMP * dt);
  } else {
    const pitched = spring(state.pitch, state.pitchVel, RIDE_PITCH, dt);
    state.pitch = pitched.value;
    state.pitchVel = pitched.vel;
  }
  const rolled = spring(state.roll, state.rollVel, 0, dt);
  state.roll = rolled.value;
  state.rollVel = rolled.vel;
  const yawed = spring(state.yaw, state.yawVel, 0, dt);
  state.yaw = yawed.value;
  state.yawVel = yawed.vel;

  let touched = false;
  const magnet = featureHeight(state);
  if (!state.airborne) {
    state.vy = 0;
    if (magnet === null) state.y = 0;
  } else {
    const hang = Math.abs(state.vy) < HANG_SPEED;
    state.vy -= (hang ? GRAVITY * HANG_SCALE : GRAVITY) * dt;
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
    const pull = Math.min(1, MAGNET_PULL * dt);
    state.y += (magnet - state.y) * pull;
    state.x += (target - state.x) * pull;
  }
  return { touched };
}
