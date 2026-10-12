/** Lane index. 0 is the board's left, 1 is center, 2 is the board's right. */
export type Lane = 0 | 1 | 2;

export type RunnerStatus = "playing" | "paused" | "gameover";

/** Grindable features only. Nothing on the street is there to be dodged. */
export type ObstacleKind = "rail" | "box";

/** Crooked grind, nose slide, or a kickflip into the crooked grind. */
export type Trick = "crooked" | "nose" | "kickflip";

export type Grade = "perfect" | "good" | "sloppy";

/**
 * `tap` arms a crooked grind, and a second tap inside the double-tap window
 * upgrades it to a nose slide. `flip` is the extra input for a kickflip in.
 * `duck` is the powerslide.
 */
export type Action = "left" | "right" | "duck" | "tap" | "flip";

/** Lock, landing, and powerslide buzz on a phone. A bail stays silent. */
export type RunnerEvent = "powerslide" | "lock" | "land" | "bail";

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  lane: Lane;
  /** Distance along the run where the near lip sits. */
  z: number;
  /** Along-track length. */
  length: number;
  /** A grind on this feature has already been scored. */
  awarded: boolean;
  /** The board has passed it, made or missed. */
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
  /** Visual lateral position. The lip check uses `lane`, which commits on the swipe. */
  x: number;
  /** Extra height while a grind holds the board on a rail or box. */
  y: number;
  /** Seconds into the powerslide, or -1. */
  duck: number;
  /** Seconds into the kickflip spin, or -1. Held at the end until the lock or the arm expires. */
  flip: number;
  onGrind: boolean;
  grindId: number | null;
  grindTrick: Trick | null;
  grade: Grade | null;
  /** Trick waiting for the next lip in this lane. */
  armed: Trick | null;
  /** Distance where the current trick was armed. Timing is measured from here to the lip. */
  armedDistance: number;
  /** Seconds since the last tap, so a second tap can become a nose slide. */
  armAge: number;
  score: number;
  trickPoints: number;
  /** Points just awarded, shown with the trick name. */
  popup: number;
  /** Good and perfect grinds in a row. A miss clears it. A sloppy make does not add to it. */
  combo: number;
  trickName: string | null;
  trickTime: number;
  obstacles: Obstacle[];
  nextId: number;
  /** World distance of the last spawned row. Infinity disables spawning. */
  spawnedUntil: number;
  rng: number;
  elapsed: number;
  grinds: number;
  /** Features in the current lane that were passed without a grind. Three ends the run. */
  misses: number;
  hasInput: boolean;
}

export interface Tick {
  state: RunnerState;
  events: RunnerEvent[];
}
