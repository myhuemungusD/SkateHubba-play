/** Lane index. 0 is the skater's left, 1 is center, 2 is the skater's right. */
export type Lane = 0 | 1 | 2;

export type RunnerStatus = "playing" | "paused" | "gameover";

export type ObstacleKind = "cone" | "barrier" | "overhead" | "rail";

export type Action = "left" | "right" | "ollie" | "duck";

/** Something the view can buzz or flash. Crash is silent in phase 1. */
export type RunnerEvent = "ollie" | "land" | "boardslide" | "crash";

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  lane: Lane;
  /** Distance along the run where the near edge sits. */
  z: number;
  /** Along-track length. Point obstacles are 0. Rails use RAIL_LENGTH. */
  length: number;
  /** Boardslide bonus already paid. */
  awarded: boolean;
  /** The skater has passed it, cleared or not. */
  resolved: boolean;
}

/**
 * Pure run state. The renderer reads it; it never writes Firebase and it
 * has no S.K.A.T.E. letters. Scores live only for this run.
 */
export interface RunnerState {
  status: RunnerStatus;
  distance: number;
  speed: number;
  lane: Lane;
  /** Visual lateral position. Gameplay collisions use `lane`, which commits on the swipe. */
  x: number;
  y: number;
  /** Seconds into the current ollie, or -1 on the ground. */
  ollie: number;
  /** Seconds into the current powerslide, or -1 standing. */
  duck: number;
  onRail: boolean;
  railId: number | null;
  score: number;
  trickName: string | null;
  trickTime: number;
  obstacles: Obstacle[];
  nextId: number;
  /** World distance of the last spawned row. Infinity disables spawning. */
  spawnedUntil: number;
  rng: number;
  elapsed: number;
  boardslides: number;
  hasInput: boolean;
}

export interface Tick {
  state: RunnerState;
  events: RunnerEvent[];
}
