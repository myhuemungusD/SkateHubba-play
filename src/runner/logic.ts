import {
  ARM_RANGE,
  BALANCE_ACTIVE_AFTER,
  BALANCE_LIMIT,
  BALANCE_NUDGE,
  BASE_SPEED,
  BOX_LENGTH,
  COYOTE_TIME,
  DOUBLE_TAP,
  DUCK_DURATION,
  EXIT_EARLY,
  EXIT_POP,
  FALL_GRAVITY_SCALE,
  FIRST_ROW_Z,
  FLIP_DURATION,
  FLIP_COMPLETE,
  FLIP_LOCK_BLEND,
  FLIP_SLOP,
  GOOD_MAX,
  GRIND_ASSIST_DEFAULT,
  GRIND_DRAG,
  GRIND_MIN_SPEED,
  HIT_STOP,
  HIT_STOP_BAIL,
  HIT_STOP_MAX,
  HIT_STOP_PERFECT,
  LAND_PRESS_BOOST,
  LAND_PRESS_WINDOW,
  LANDING_BONUS,
  LANE_X,
  LANES,
  LATE_LOCK,
  LEAN_RATE,
  MAX_FRAME_DT,
  MAX_SPEED,
  MISS_LIMIT,
  OLLIE_POP,
  POWERSLIDE_SHED,
  PERFECT_MAX,
  PERFECT_MIN,
  POP_NOSE,
  RAIL_LENGTH,
  RIDE_PITCH,
  ROW_GAP,
  SPAWN_AHEAD,
  SPEED_RAMP,
  TRICK_NAMES,
  TRICK_BUFFER,
  TRICK_POINTS,
  TRICK_POWERSLIDE,
  coyoteDistance,
  multiplierFor,
} from "./constants";
import { curveSample, grindDirectionOk } from "./railCurve";
import { gradeTouchdown, integrateMotion, popScale, stepBalance, timeToGround } from "./physics";
import { nextUnit } from "./rng";
import type {
  Action,
  FlickGrade,
  Grade,
  Lane,
  Obstacle,
  ObstacleKind,
  RunnerEvent,
  RunnerState,
  Tick,
  Trick,
} from "./types";

const FULL_FLICK: FlickGrade = { accuracy: 5, speed: 5 };

export interface CreateRunOptions {
  seed?: number;
  lane?: Lane;
  obstacles?: Obstacle[];
  /** When false, the street stays empty. Tests place their own features. */
  spawn?: boolean;
  startPaused?: boolean;
  fallScale?: number;
  grindAssist?: number;
}

export function laneAfter(lane: Lane, direction: "left" | "right"): Lane {
  const next = direction === "left" ? lane - 1 : lane + 1;
  if (next < 0 || next > 2) return lane;
  return next as Lane;
}

/**
 * Lead is how many units before the lip the trick was armed.
 * Negative lead means the input landed after the lip and is sketchy
 * if it is still inside the late window.
 */
export function gradeForLead(lead: number): Grade {
  if (lead >= PERFECT_MIN && lead <= PERFECT_MAX) return "perfect";
  if (lead >= 0 && lead <= GOOD_MAX) return "clean";
  return "sketchy";
}

export function createRun(options: CreateRunOptions = {}): RunnerState {
  const lane = options.lane ?? 1;
  const seed = options.seed ?? 1;
  const obstacles = options.obstacles?.map((obstacle) => ({ ...obstacle })) ?? [];
  const nextId = obstacles.reduce((max, obstacle) => Math.max(max, obstacle.id), 0) + 1;
  return {
    status: options.startPaused ? "paused" : "playing",
    distance: 0,
    speed: BASE_SPEED,
    lane,
    x: LANE_X[lane],
    y: 0,
    vy: 0,
    vx: 0,
    pitch: RIDE_PITCH,
    yaw: 0,
    roll: 0,
    pitchVel: 0,
    yawVel: 0,
    rollVel: 0,
    squash: 0,
    balance: 0,
    balanceDrift: seed % 2 === 0 ? -1 : 1,
    balanceVel: 0,
    airborne: false,
    popV0: 0,
    flickSpeed: 5,
    flickAccuracy: 5,
    flipSlopApplied: false,
    flipBlend: 0,
    timedLand: false,
    exitCoyote: 0,
    crashed: false,
    popAge: 0,
    popped: false,
    earlyPop: false,
    pendingLanding: false,
    grindTime: 0,
    grindS: 0,
    fallScale: options.fallScale ?? FALL_GRAVITY_SCALE,
    grindAssist: options.grindAssist ?? GRIND_ASSIST_DEFAULT,
    hitStop: 0,
    duck: -1,
    flip: -1,
    onGrind: false,
    grindId: null,
    grindTrick: null,
    grade: null,
    armed: null,
    armedDistance: 0,
    armAge: 0,
    score: 0,
    trickPoints: 0,
    popup: 0,
    combo: 0,
    trickName: null,
    trickTime: 0,
    obstacles,
    nextId,
    spawnedUntil: options.spawn === false ? Number.POSITIVE_INFINITY : 0,
    rng: seed,
    elapsed: 0,
    grinds: 0,
    misses: 0,
    hasInput: false,
  };
}

function popBoard(state: RunnerState, trick: Trick, flick: FlickGrade): void {
  const scale = popScale(flick.speed);
  state.airborne = true;
  state.popV0 = (trick === "kickflip" ? OLLIE_POP * 0.94 : OLLIE_POP) * scale;
  state.vy = state.popV0;
  state.flickSpeed = flick.speed;
  state.flickAccuracy = flick.accuracy;
  state.flipSlopApplied = false;
  state.pitchVel = POP_NOSE;
  state.popAge = 0;
  state.squash = 0;
  if (trick === "kickflip") state.rollVel = 2.4;
}

function commit(prev: RunnerState, trick: Trick, flick: FlickGrade): Tick {
  const state: RunnerState = {
    ...prev,
    armed: trick,
    armedDistance: prev.distance,
    armAge: trick === "nose" ? prev.armAge : 0,
    duck: -1,
    flip: trick === "kickflip" ? 0 : -1,
    flickSpeed: flick.speed,
    flickAccuracy: flick.accuracy,
  };
  const events: RunnerEvent[] = [];
  if (!prev.airborne && prev.duck < 0 && !prev.onGrind) {
    popBoard(state, trick, flick);
    events.push("pop");
  } else if (trick === "kickflip" && !prev.onGrind) {
    state.rollVel = 2.4;
    state.flip = 0;
    state.flipSlopApplied = false;
    events.push("pop");
  }
  return { state, events };
}

/** Freeze, then the next steps end the run. The picture holds for the crash. */
function crash(prev: RunnerState): Tick {
  return {
    state: {
      ...prev,
      crashed: true,
      hitStop: Math.min(HIT_STOP_MAX, HIT_STOP_BAIL),
      onGrind: false,
      grindId: null,
      grindTrick: null,
      armed: null,
      flip: -1,
      flipBlend: 0,
      duck: -1,
      trickName: null,
      trickTime: 0,
      grade: null,
      popup: 0,
      vy: 0,
      airborne: false,
      pendingLanding: false,
      score: Math.floor(prev.distance) + prev.trickPoints,
    },
    events: ["bail"],
  };
}

function windowEnd(state: RunnerState, obstacle: Obstacle): number {
  return obstacle.z + LATE_LOCK + coyoteDistance(state.speed);
}

/** A trick input after the late window and coyote time, while the feature is still under the board. */
function slamming(state: RunnerState): boolean {
  for (const obstacle of state.obstacles) {
    if (obstacle.lane !== state.lane || obstacle.resolved || obstacle.awarded) continue;
    const end = obstacle.z + obstacle.length;
    if (state.distance > windowEnd(state, obstacle) && state.distance < end) return true;
  }
  return false;
}

function nudge(prev: RunnerState, direction: "left" | "right"): Tick {
  const delta = direction === "left" ? -BALANCE_NUDGE : BALANCE_NUDGE;
  const balance = Math.max(-1.4, Math.min(1.4, prev.balance + delta));
  return { state: { ...prev, balance, balanceVel: prev.balanceVel * 0.35 }, events: [] };
}

/** Tap during a grind pops off. A pop in the first half cannot land perfect. */
function popOff(prev: RunnerState): Tick {
  const feature = prev.obstacles.find((obstacle) => obstacle.id === prev.grindId);
  const along = feature ? prev.distance - feature.z : 0;
  const early = !feature || along < feature.length * EXIT_EARLY;
  return {
    state: {
      ...prev,
      onGrind: false,
      grindId: null,
      airborne: true,
      pendingLanding: true,
      popped: true,
      earlyPop: early,
      vy: EXIT_POP,
      popV0: EXIT_POP,
      y: prev.y + 0.02,
      popAge: 0,
      pitchVel: POP_NOSE,
      grindTime: 0,
      hitStop: 0,
      exitCoyote: 0,
    },
    events: ["pop"],
  };
}

export function applyAction(prev: RunnerState, action: Action, flick: FlickGrade = FULL_FLICK): Tick {
  if (prev.status !== "playing" || prev.crashed) return { state: prev, events: [] };
  switch (action) {
    case "left":
    case "right": {
      if (prev.onGrind) return nudge(prev, action);
      const lane = laneAfter(prev.lane, action);
      if (lane === prev.lane) return { state: prev, events: [] };
      return { state: { ...prev, lane }, events: [] };
    }
    case "tap":
    case "flip": {
      if (prev.onGrind) return popOff(prev);
      if (prev.hitStop > 0) return { state: prev, events: [] };
      if (prev.pendingLanding && prev.airborne && (timeToGround(prev) <= TRICK_BUFFER || prev.exitCoyote > 0)) {
        const eta = timeToGround(prev);
        return {
          state: {
            ...prev,
            timedLand: eta <= LAND_PRESS_WINDOW,
            popped: true,
            earlyPop: prev.exitCoyote > 0 ? false : prev.earlyPop,
          },
          events: [],
        };
      }
      if (slamming(prev)) return crash(prev);
      if (action === "tap" && prev.armed === "crooked" && prev.armAge <= DOUBLE_TAP) {
        return commit(prev, "nose", flick);
      }
      return commit(prev, action === "flip" ? "kickflip" : "crooked", flick);
    }
    case "duck": {
      if (prev.onGrind || prev.duck >= 0) return { state: prev, events: [] };
      const showSlide = prev.trickTime <= 0 && !prev.trickName;
      return {
        state: {
          ...prev,
          duck: 0,
          armed: null,
          flip: -1,
          airborne: false,
          vy: 0,
          popV0: 0,
          y: 0,
          pendingLanding: false,
          speed: Math.max(GRIND_MIN_SPEED, prev.speed * (1 - POWERSLIDE_SHED)),
          trickName: showSlide ? TRICK_POWERSLIDE : prev.trickName,
          trickTime: showSlide ? 0.55 : prev.trickTime,
        },
        events: ["powerslide"],
      };
    }
    default: {
      const neverAction: never = action;
      return neverAction;
    }
  }
}

/** Held finger or key. Only matters while locked. `lean` is -1..1. */
export function applyLean(prev: RunnerState, lean: number, dt: number): RunnerState {
  if (!prev.onGrind || lean === 0 || dt <= 0) return prev;
  const balance = Math.max(-1.4, Math.min(1.4, prev.balance + lean * LEAN_RATE * dt));
  return { ...prev, balance, balanceVel: prev.balanceVel * 0.35 };
}

function take(state: RunnerState): number {
  const next = nextUnit(state.rng);
  state.rng = next.seed;
  return next.value;
}

function pickLane(state: RunnerState): Lane {
  const index = Math.floor(take(state) * LANES.length);
  return LANES[index] ?? 1;
}

function makeObstacle(state: RunnerState, kind: ObstacleKind, lane: Lane, z: number): Obstacle {
  const obstacle: Obstacle = {
    id: state.nextId,
    kind,
    lane,
    z,
    length: kind === "rail" ? RAIL_LENGTH : BOX_LENGTH,
    awarded: false,
    resolved: false,
  };
  state.nextId += 1;
  return obstacle;
}

/** One or two grind spots per row. The third lane stays open. */
function spawnAhead(state: RunnerState): void {
  let guard = 0;
  while (state.spawnedUntil < state.distance + SPAWN_AHEAD && guard < 12) {
    guard += 1;
    const z = state.spawnedUntil === 0 ? FIRST_ROW_Z : state.spawnedUntil + ROW_GAP;
    const rowIndex = state.spawnedUntil === 0 ? 0 : Math.round((z - FIRST_ROW_Z) / ROW_GAP);
    if (rowIndex < 2) {
      state.obstacles.push(makeObstacle(state, rowIndex === 0 ? "rail" : "box", 0, z));
    } else {
      const kind: ObstacleKind = take(state) < 0.55 ? "rail" : "box";
      const lane = pickLane(state);
      state.obstacles.push(makeObstacle(state, kind, lane, z));
      if (take(state) < 0.3) {
        const other = LANES.find((candidate) => candidate !== lane) ?? lane;
        const second: ObstacleKind = kind === "rail" ? "box" : "rail";
        state.obstacles.push(makeObstacle(state, second, other, z));
      }
    }
    state.spawnedUntil = z;
  }
}

function award(state: RunnerState, trick: Trick, grade: Grade): void {
  const chain = grade === "sketchy" ? Math.max(state.combo, 1) : state.combo + 1;
  const mult = grade === "sketchy" ? 1 : multiplierFor(chain);
  const points = Math.round(TRICK_POINTS[trick][grade] * mult);
  if (grade !== "sketchy") state.combo = chain;
  state.trickPoints += points;
  state.popup = points;
  state.grade = grade;
  state.trickName = TRICK_NAMES[trick];
  state.trickTime = 0;
  state.grinds += 1;
  state.misses = 0;
}

/** A rising pop does not lock. Rolling, or coming down, does. */
function descending(state: RunnerState): boolean {
  if (!state.airborne) return true;
  return state.vy < 0;
}

function tryLock(state: RunnerState, prevDistance: number, events: RunnerEvent[]): void {
  if (state.onGrind || state.duck >= 0 || !state.armed) return;
  if (!descending(state)) return;
  if (prevDistance - state.armedDistance > ARM_RANGE) return;
  for (const obstacle of state.obstacles) {
    if (obstacle.lane !== state.lane || obstacle.resolved || obstacle.awarded) continue;
    const end = windowEnd(state, obstacle);
    if (prevDistance > end || state.distance < obstacle.z) continue;
    if (state.armedDistance > end) continue;
    const along = Math.max(0, state.distance - obstacle.z);
    const sample = curveSample(obstacle, along);
    if (!grindDirectionOk(state.vx, state.speed, sample.tx, sample.tz)) continue;
    const trick = state.armed;
    const grade = gradeForLead(obstacle.z - state.armedDistance);
    obstacle.awarded = true;
    state.onGrind = true;
    state.grindId = obstacle.id;
    state.grindTrick = trick;
    state.grindTime = 0;
    state.grindS = along;
    state.lane = obstacle.lane;
    state.x = sample.x;
    state.vx = 0;
    state.y = sample.y;
    state.vy = 0;
    state.airborne = false;
    state.pendingLanding = false;
    state.squash = 0;
    state.balance = 0;
    state.balanceVel = 0;
    state.popV0 = 0;
    state.armed = null;
    state.flipBlend = state.flip >= 0 ? FLIP_LOCK_BLEND : 0;
    if (state.flipBlend === 0) state.flip = -1;
    state.duck = -1;
    if (state.speed < GRIND_MIN_SPEED) state.speed = GRIND_MIN_SPEED;
    state.hitStop = Math.min(HIT_STOP_MAX, HIT_STOP);
    award(state, trick, grade);
    events.push("lock");
    return;
  }
}

function followGrind(state: RunnerState): void {
  const feature = state.obstacles.find((obstacle) => obstacle.id === state.grindId);
  const end = feature ? feature.z + feature.length : state.distance;
  if (feature) {
    const along = Math.max(0, state.distance - feature.z);
    const sample = curveSample(feature, along);
    state.grindS = along;
    state.lane = feature.lane;
    state.x = sample.x;
    state.y = sample.y;
  }
  if (!feature || state.distance < end) return;
  state.onGrind = false;
  state.grindId = null;
  state.grindTime = 0;
  state.airborne = true;
  state.pendingLanding = true;
  state.popped = false;
  state.earlyPop = false;
  state.vy = EXIT_POP * 0.82;
  state.popV0 = EXIT_POP * 0.82;
  state.y += 0.02;
  state.popAge = 0;
  state.pitchVel = POP_NOSE * 0.65;
  state.exitCoyote = COYOTE_TIME;
}

function flipProgress(state: RunnerState): number {
  if (state.flip < 0) return 1;
  return Math.min(1, state.flip / FLIP_DURATION);
}

function payLanding(state: RunnerState, events: RunnerEvent[]): void {
  const pressed = state.timedLand;
  let grade = gradeTouchdown({ ...state, flipComplete: flipProgress(state) });
  if (pressed && grade === "clean" && flipProgress(state) >= FLIP_COMPLETE) grade = "perfect";
  state.pendingLanding = false;
  state.timedLand = false;
  state.exitCoyote = 0;
  if (grade === "bail") {
    const fallen = crash(state);
    Object.assign(state, fallen.state);
    events.push("bail");
    return;
  }
  const points = LANDING_BONUS[grade];
  state.trickPoints += points;
  state.popup = points;
  state.grade = grade;
  state.trickTime = 1.15;
  if (grade === "perfect") state.hitStop = Math.min(HIT_STOP_MAX, HIT_STOP_PERFECT);
  if (pressed) state.speed = Math.min(MAX_SPEED, state.speed + LAND_PRESS_BOOST);
  events.push("land");
}

function resolvePasses(state: RunnerState, events: RunnerEvent[]): void {
  for (const obstacle of state.obstacles) {
    if (obstacle.resolved || obstacle.awarded) continue;
    if (state.distance <= obstacle.z + obstacle.length) continue;
    obstacle.resolved = true;
    if (obstacle.lane !== state.lane) continue;
    state.combo = 0;
    state.misses += 1;
    if (state.misses >= MISS_LIMIT) {
      const fallen = crash(state);
      Object.assign(state, fallen.state);
      events.push("bail");
      return;
    }
  }
}

/**
 * Advance one slice. `dt` should be at most MAX_FRAME_DT; larger values are
 * clamped so a single call cannot skip a lip. The controller feeds FIXED_DT.
 */
export function stepRun(prev: RunnerState, dt: number): Tick {
  if (prev.status !== "playing") return { state: prev, events: [] };
  let slice = Math.min(Math.max(dt, 0), MAX_FRAME_DT);
  if (slice === 0) return { state: prev, events: [] };

  const state: RunnerState = {
    ...prev,
    obstacles: prev.obstacles.map((obstacle) => ({ ...obstacle })),
  };
  const events: RunnerEvent[] = [];

  if (state.crashed) {
    state.hitStop -= slice;
    if (state.hitStop <= 0) {
      state.hitStop = 0;
      state.status = "gameover";
    }
    return { state, events };
  }

  if (state.hitStop > 0) {
    const used = Math.min(state.hitStop, slice);
    state.hitStop -= used;
    slice -= used;
    if (slice <= 1e-6) return { state, events };
  }

  if (state.duck >= 0) {
    state.duck += slice;
    if (state.duck >= DUCK_DURATION) state.duck = -1;
  }
  if (state.flip >= 0 && state.flip < FLIP_DURATION) {
    state.flip = Math.min(FLIP_DURATION, state.flip + slice);
  }
  if (state.flipBlend > 0) {
    state.flipBlend = Math.max(0, state.flipBlend - slice);
    if (state.flipBlend === 0) state.flip = -1;
  }
  if (state.exitCoyote > 0) state.exitCoyote = Math.max(0, state.exitCoyote - slice);
  if (state.armed) state.armAge += slice;
  if (state.onGrind) state.grindTime += slice;

  const prevDistance = state.distance;
  state.distance += state.speed * slice;
  state.elapsed += slice;
  state.speed = Math.min(MAX_SPEED, state.speed + SPEED_RAMP * slice);

  const motion = integrateMotion(state, slice);
  if (state.airborne && !state.onGrind && state.flip >= FLIP_DURATION && !state.flipSlopApplied) {
    state.roll += (1 - Math.max(1, Math.min(5, state.flickAccuracy)) / 5) * FLIP_SLOP;
    state.flipSlopApplied = true;
  }

  if (state.onGrind) {
    state.speed = Math.max(GRIND_MIN_SPEED, state.speed - GRIND_DRAG * slice);
    stepBalance(state, slice);
    followGrind(state);
    if (state.onGrind && state.grindTime > BALANCE_ACTIVE_AFTER && Math.abs(state.balance) > BALANCE_LIMIT) {
      return crash(state);
    }
  } else {
    tryLock(state, prevDistance, events);
    if (state.armed && state.distance - state.armedDistance > ARM_RANGE) {
      state.armed = null;
      state.flip = -1;
    }
    if (motion.touched && state.pendingLanding && !state.crashed) {
      payLanding(state, events);
    }
  }

  if (state.crashed) return { state, events };

  if (state.status === "playing") resolvePasses(state, events);
  if (state.crashed) return { state, events };

  if (state.status === "playing") {
    spawnAhead(state);
    const grindId = state.grindId;
    state.obstacles = state.obstacles.filter(
      (obstacle) => obstacle.id === grindId || obstacle.z + obstacle.length >= state.distance - 12,
    );
  }

  state.score = Math.floor(state.distance) + state.trickPoints;

  if (!state.onGrind && state.trickTime > 0) {
    state.trickTime = Math.max(0, state.trickTime - slice);
    if (state.trickTime === 0) {
      state.trickName = null;
      state.grade = null;
      state.popup = 0;
    }
  }

  return { state, events };
}
