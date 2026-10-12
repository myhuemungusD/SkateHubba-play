import {
  BASE_SPEED,
  BOARDSLIDE_BONUS,
  CONE_CLEAR_Y,
  DUCK_DURATION,
  FIRST_ROW_Z,
  LANE_SLIDE,
  LANE_X,
  LANES,
  MAX_FRAME_DT,
  MAX_SPEED,
  OLLIE_DURATION,
  OLLIE_PEAK,
  RAIL_LENGTH,
  RAIL_LOCK_Y,
  RAIL_Y,
  ROW_GAP,
  SPAWN_AHEAD,
  SPEED_RAMP,
  TRICK_BOARDSLIDE,
} from "./constants";
import { nextUnit } from "./rng";
import type { Action, Lane, Obstacle, ObstacleKind, RunnerEvent, RunnerState, Tick } from "./types";

export interface CreateRunOptions {
  seed?: number;
  lane?: Lane;
  obstacles?: Obstacle[];
  /** When false, the street stays empty. Tests place their own obstacles. */
  spawn?: boolean;
  startPaused?: boolean;
}

export function laneAfter(lane: Lane, direction: "left" | "right"): Lane {
  const next = direction === "left" ? lane - 1 : lane + 1;
  if (next < 0 || next > 2) return lane;
  return next as Lane;
}

/** Sine hop. 0 at the takeoff and the landing, `peak` at the halfway point. */
export function ollieArc(elapsed: number, duration = OLLIE_DURATION, peak = OLLIE_PEAK): number {
  if (!(elapsed >= 0) || elapsed >= duration || duration <= 0) return 0;
  return Math.sin((elapsed / duration) * Math.PI) * peak;
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
    ollie: -1,
    duck: -1,
    onRail: false,
    railId: null,
    score: 0,
    trickName: null,
    trickTime: 0,
    obstacles,
    nextId,
    spawnedUntil: options.spawn === false ? Number.POSITIVE_INFINITY : 0,
    rng: options.seed ?? 1,
    elapsed: 0,
    boardslides: 0,
    hasInput: false,
  };
}

export function applyAction(prev: RunnerState, action: Action): Tick {
  if (prev.status !== "playing") return { state: prev, events: [] };
  switch (action) {
    case "left":
    case "right": {
      if (prev.onRail) return { state: prev, events: [] };
      const lane = laneAfter(prev.lane, action);
      if (lane === prev.lane) return { state: prev, events: [] };
      return { state: { ...prev, lane }, events: [] };
    }
    case "ollie": {
      if (prev.onRail || prev.ollie >= 0 || prev.duck >= 0) return { state: prev, events: [] };
      return { state: { ...prev, ollie: 0, y: 0 }, events: ["ollie"] };
    }
    case "duck": {
      if (prev.onRail || prev.ollie >= 0 || prev.duck >= 0) return { state: prev, events: [] };
      return { state: { ...prev, duck: 0 }, events: [] };
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

function pickKind(roll: number): ObstacleKind {
  if (roll < 0.34) return "cone";
  if (roll < 0.67) return "barrier";
  return "overhead";
}

function makeObstacle(state: RunnerState, kind: ObstacleKind, lane: Lane, z: number, length: number): Obstacle {
  const obstacle: Obstacle = {
    id: state.nextId,
    kind,
    lane,
    z,
    length,
    awarded: false,
    resolved: false,
  };
  state.nextId += 1;
  return obstacle;
}

/** Fill the street ahead. Every row leaves at least one lane open. */
function spawnAhead(state: RunnerState): void {
  let guard = 0;
  while (state.spawnedUntil < state.distance + SPAWN_AHEAD && guard < 16) {
    guard += 1;
    const z = state.spawnedUntil === 0 ? FIRST_ROW_Z : state.spawnedUntil + ROW_GAP;
    const rowIndex = state.spawnedUntil === 0 ? 0 : Math.round((z - FIRST_ROW_Z) / ROW_GAP);
    if (rowIndex < 2) {
      // Opening cones sit in the left lane so the center start is a free run.
      state.obstacles.push(makeObstacle(state, "cone", 0, z, 0));
    } else {
      const roll = take(state);
      if (roll < 0.18) {
        state.obstacles.push(makeObstacle(state, "rail", pickLane(state), z, RAIL_LENGTH));
      } else if (roll < 0.45) {
        const open = pickLane(state);
        for (const lane of LANES) {
          if (lane === open) continue;
          state.obstacles.push(makeObstacle(state, pickKind(take(state)), lane, z, 0));
        }
      } else {
        state.obstacles.push(makeObstacle(state, pickKind(take(state)), pickLane(state), z, 0));
      }
    }
    state.spawnedUntil = z;
  }
}

function clears(state: RunnerState, obstacle: Obstacle): boolean {
  switch (obstacle.kind) {
    case "cone":
      return state.y >= CONE_CLEAR_Y;
    case "barrier":
      return false;
    case "overhead":
      return state.duck >= 0 && state.ollie < 0;
    case "rail":
      return true;
    default: {
      const neverKind: never = obstacle.kind;
      return neverKind;
    }
  }
}

function followRail(state: RunnerState, events: RunnerEvent[]): void {
  const rail = state.obstacles.find((obstacle) => obstacle.id === state.railId);
  const end = rail ? rail.z + rail.length : state.distance;
  if (rail) {
    state.lane = rail.lane;
    state.x = LANE_X[rail.lane];
  }
  state.y = RAIL_Y;
  state.trickName = TRICK_BOARDSLIDE;
  if (!rail || state.distance >= end) {
    state.onRail = false;
    state.railId = null;
    state.y = 0;
    state.trickTime = 0.9;
    events.push("land");
  }
}

function tryLockRail(state: RunnerState, events: RunnerEvent[]): void {
  if (state.onRail || state.duck >= 0 || state.y > RAIL_LOCK_Y) return;
  for (const obstacle of state.obstacles) {
    if (obstacle.kind !== "rail" || obstacle.awarded) continue;
    if (obstacle.lane !== state.lane) continue;
    const end = obstacle.z + obstacle.length;
    if (state.distance < obstacle.z || state.distance > end) continue;
    state.onRail = true;
    state.railId = obstacle.id;
    state.ollie = -1;
    state.y = RAIL_Y;
    state.x = LANE_X[obstacle.lane];
    state.trickName = TRICK_BOARDSLIDE;
    state.trickTime = 0;
    obstacle.awarded = true;
    state.boardslides += 1;
    events.push("boardslide");
    return;
  }
}

function collide(state: RunnerState, prevDistance: number, events: RunnerEvent[]): void {
  for (const obstacle of state.obstacles) {
    if (obstacle.kind === "rail" || obstacle.resolved) continue;
    if (obstacle.z <= prevDistance || obstacle.z > state.distance) continue;
    if (state.onRail || obstacle.lane !== state.lane || clears(state, obstacle)) {
      obstacle.resolved = true;
      continue;
    }
    state.status = "gameover";
    state.trickName = null;
    state.onRail = false;
    state.railId = null;
    events.push("crash");
    return;
  }
}

/**
 * Advance one slice. `dt` should be at most MAX_FRAME_DT; larger values are
 * clamped so a single call cannot skip an obstacle.
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

  if (state.ollie >= 0) {
    state.ollie += slice;
    state.y = ollieArc(state.ollie);
    if (state.ollie >= OLLIE_DURATION) {
      state.ollie = -1;
      state.y = 0;
      events.push("land");
    }
  } else if (!state.onRail) {
    state.y = 0;
  }

  const prevDistance = state.distance;
  state.distance += state.speed * slice;
  state.elapsed += slice;
  state.speed = Math.min(MAX_SPEED, state.speed + SPEED_RAMP * slice);

  if (state.onRail) {
    followRail(state, events);
  } else {
    const target = LANE_X[state.lane];
    const dx = target - state.x;
    const step = Math.min(Math.abs(dx), LANE_SLIDE * slice);
    state.x += Math.sign(dx) * step;
    tryLockRail(state, events);
  }

  if (state.status === "playing") collide(state, prevDistance, events);

  if (state.status === "playing") {
    spawnAhead(state);
    const railId = state.railId;
    state.obstacles = state.obstacles.filter(
      (obstacle) => obstacle.id === railId || obstacle.z + obstacle.length >= state.distance - 16,
    );
  }

  state.score = Math.floor(state.distance) + state.boardslides * BOARDSLIDE_BONUS;

  if (!state.onRail && state.trickTime > 0) {
    state.trickTime = Math.max(0, state.trickTime - slice);
    if (state.trickTime === 0) state.trickName = null;
  }

  return { state, events };
}
