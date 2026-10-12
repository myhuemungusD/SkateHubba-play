import {
  ARM_RANGE,
  BASE_SPEED,
  BOX_LENGTH,
  BOX_Y,
  DOUBLE_TAP,
  DUCK_DURATION,
  FIRST_ROW_Z,
  FLIP_DURATION,
  GOOD_MAX,
  LANE_SLIDE,
  LANE_X,
  LANES,
  LATE_LOCK,
  MAX_FRAME_DT,
  MAX_SPEED,
  MISS_LIMIT,
  PERFECT_MAX,
  PERFECT_MIN,
  RAIL_LENGTH,
  RAIL_Y,
  ROW_GAP,
  SPAWN_AHEAD,
  SPEED_RAMP,
  TRICK_NAMES,
  TRICK_POINTS,
  TRICK_POWERSLIDE,
  multiplierFor,
} from "./constants";
import { nextUnit } from "./rng";
import type {
  Action,
  Grade,
  Lane,
  Obstacle,
  ObstacleKind,
  RunnerEvent,
  RunnerState,
  Tick,
  Trick,
} from "./types";

export interface CreateRunOptions {
  seed?: number;
  lane?: Lane;
  obstacles?: Obstacle[];
  /** When false, the street stays empty. Tests place their own features. */
  spawn?: boolean;
  startPaused?: boolean;
}

export function laneAfter(lane: Lane, direction: "left" | "right"): Lane {
  const next = direction === "left" ? lane - 1 : lane + 1;
  if (next < 0 || next > 2) return lane;
  return next as Lane;
}

/**
 * Lead is how many units before the lip the trick was armed.
 * Negative lead means the input landed after the lip and is sloppy
 * if it is still inside the late window.
 */
export function gradeForLead(lead: number): Grade {
  if (lead >= PERFECT_MIN && lead <= PERFECT_MAX) return "perfect";
  if (lead >= 0 && lead <= GOOD_MAX) return "good";
  return "sloppy";
}

export function createRun(options: CreateRunOptions = {}): RunnerState {
  const lane = options.lane ?? 1;
  const obstacles = options.obstacles?.map((obstacle) => ({ ...obstacle })) ?? [];
  const nextId = obstacles.reduce((max, obstacle) => Math.max(max, obstacle.id), 0) + 1;
  return {
    status: options.startPaused ? "paused" : "playing",
    distance: 0,
    speed: BASE_SPEED,
    lane,
    x: LANE_X[lane],
    y: 0,
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
    rng: options.seed ?? 1,
    elapsed: 0,
    grinds: 0,
    misses: 0,
    hasInput: false,
  };
}

function commit(prev: RunnerState, trick: Trick): Tick {
  return {
    state: {
      ...prev,
      armed: trick,
      armedDistance: prev.distance,
      armAge: trick === "nose" ? prev.armAge : 0,
      duck: -1,
      flip: trick === "kickflip" ? 0 : -1,
    },
    events: [],
  };
}

function bail(prev: RunnerState): Tick {
  return {
    state: {
      ...prev,
      status: "gameover",
      onGrind: false,
      grindId: null,
      grindTrick: null,
      armed: null,
      flip: -1,
      duck: -1,
      trickName: null,
      trickTime: 0,
      grade: null,
      popup: 0,
      y: 0,
    },
    events: ["bail"],
  };
}

/** A trick input after the late window, while the feature is still under the board. */
function slamming(state: RunnerState): boolean {
  for (const obstacle of state.obstacles) {
    if (obstacle.lane !== state.lane || obstacle.resolved || obstacle.awarded) continue;
    const end = obstacle.z + obstacle.length;
    if (state.distance > obstacle.z + LATE_LOCK && state.distance < end) return true;
  }
  return false;
}

export function applyAction(prev: RunnerState, action: Action): Tick {
  if (prev.status !== "playing") return { state: prev, events: [] };
  switch (action) {
    case "left":
    case "right": {
      if (prev.onGrind) return { state: prev, events: [] };
      const lane = laneAfter(prev.lane, action);
      if (lane === prev.lane) return { state: prev, events: [] };
      return { state: { ...prev, lane }, events: [] };
    }
    case "tap": {
      if (prev.onGrind) return { state: prev, events: [] };
      if (slamming(prev)) return bail(prev);
      if (prev.armed === "crooked" && prev.armAge <= DOUBLE_TAP) return commit(prev, "nose");
      return commit(prev, "crooked");
    }
    case "flip": {
      if (prev.onGrind) return { state: prev, events: [] };
      if (slamming(prev)) return bail(prev);
      return commit(prev, "kickflip");
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
      // Opening features sit in the left lane so the center start is a free roll.
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
  const chain = grade === "sloppy" ? Math.max(state.combo, 1) : state.combo + 1;
  const mult = grade === "sloppy" ? 1 : multiplierFor(chain);
  const points = Math.round(TRICK_POINTS[trick][grade] * mult);
  if (grade !== "sloppy") state.combo = chain;
  state.trickPoints += points;
  state.popup = points;
  state.grade = grade;
  state.trickName = TRICK_NAMES[trick];
  state.trickTime = 0;
  state.grinds += 1;
  state.misses = 0;
}

function tryLock(state: RunnerState, prevDistance: number, events: RunnerEvent[]): void {
  if (state.onGrind || state.duck >= 0 || !state.armed) return;
  if (prevDistance - state.armedDistance > ARM_RANGE) return;
  for (const obstacle of state.obstacles) {
    if (obstacle.lane !== state.lane || obstacle.resolved || obstacle.awarded) continue;
    const windowEnd = obstacle.z + LATE_LOCK;
    if (prevDistance > windowEnd || state.distance < obstacle.z) continue;
    if (state.armedDistance > windowEnd) continue;
    const trick = state.armed;
    obstacle.awarded = true;
    state.onGrind = true;
    state.grindId = obstacle.id;
    state.grindTrick = trick;
    state.lane = obstacle.lane;
    state.x = LANE_X[obstacle.lane];
    state.y = obstacle.kind === "rail" ? RAIL_Y : BOX_Y;
    state.armed = null;
    state.flip = -1;
    state.duck = -1;
    award(state, trick, gradeForLead(obstacle.z - state.armedDistance));
    events.push("lock");
    return;
  }
}

function followGrind(state: RunnerState, events: RunnerEvent[]): void {
  const feature = state.obstacles.find((obstacle) => obstacle.id === state.grindId);
  const end = feature ? feature.z + feature.length : state.distance;
  if (feature) {
    state.lane = feature.lane;
    state.x = LANE_X[feature.lane];
    state.y = feature.kind === "rail" ? RAIL_Y : BOX_Y;
  }
  if (!feature || state.distance >= end) {
    state.onGrind = false;
    state.grindId = null;
    state.y = 0;
    state.trickTime = 1.15;
    events.push("land");
  }
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
      state.status = "gameover";
      state.onGrind = false;
      state.grindId = null;
      state.armed = null;
      state.flip = -1;
      state.trickName = null;
      state.trickTime = 0;
      state.grade = null;
      state.popup = 0;
      state.y = 0;
      events.push("bail");
      return;
    }
  }
}

/**
 * Advance one slice. `dt` should be at most MAX_FRAME_DT; larger values are
 * clamped so a single call cannot skip a lip.
 */
export function stepRun(prev: RunnerState, dt: number): Tick {
  if (prev.status !== "playing") return { state: prev, events: [] };
  const slice = Math.min(Math.max(dt, 0), MAX_FRAME_DT);
  if (slice === 0) return { state: prev, events: [] };

  const state: RunnerState = {
    ...prev,
    obstacles: prev.obstacles.map((obstacle) => ({ ...obstacle })),
  };
  const events: RunnerEvent[] = [];

  if (state.duck >= 0) {
    state.duck += slice;
    if (state.duck >= DUCK_DURATION) state.duck = -1;
  }
  if (state.flip >= 0 && state.flip < FLIP_DURATION) {
    state.flip = Math.min(FLIP_DURATION, state.flip + slice);
  }
  if (state.armed) state.armAge += slice;

  const prevDistance = state.distance;
  state.distance += state.speed * slice;
  state.elapsed += slice;
  state.speed = Math.min(MAX_SPEED, state.speed + SPEED_RAMP * slice);

  if (state.onGrind) {
    followGrind(state, events);
  } else {
    const target = LANE_X[state.lane];
    const dx = target - state.x;
    const step = Math.min(Math.abs(dx), LANE_SLIDE * slice);
    state.x += Math.sign(dx) * step;
    state.y = 0;
    tryLock(state, prevDistance, events);
    if (state.armed && state.distance - state.armedDistance > ARM_RANGE) {
      state.armed = null;
      state.flip = -1;
    }
  }

  if (state.status === "playing") resolvePasses(state, events);

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
