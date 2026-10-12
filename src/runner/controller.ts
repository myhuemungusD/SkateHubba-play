import { MAX_FRAME_DT, TRICK_BOARDSLIDE } from "./constants";
import { playRunnerHaptic } from "./haptics";
import { applyAction, createRun, stepRun, type CreateRunOptions } from "./logic";
import type { Action, Lane, RunnerEvent, RunnerState, RunnerStatus } from "./types";

export interface HudSnapshot {
  status: RunnerStatus;
  score: number;
  distance: number;
  lane: Lane;
  trickName: string | null;
  showHint: boolean;
  announce: string;
}

export interface RunnerController {
  getState: () => RunnerState;
  getHud: () => HudSnapshot;
  subscribe: (listener: () => void) => () => void;
  input: (action: Action) => void;
  step: (dt: number) => void;
  pause: () => void;
  resume: () => void;
  restart: () => void;
}

function laneName(lane: Lane): string {
  switch (lane) {
    case 0:
      return "Left lane";
    case 1:
      return "Center lane";
    case 2:
      return "Right lane";
    default: {
      const neverLane: never = lane;
      return neverLane;
    }
  }
}

function announceFor(state: RunnerState): string {
  if (state.status === "gameover") return `Game over. Score ${state.score}.`;
  if (state.trickName === TRICK_BOARDSLIDE) return TRICK_BOARDSLIDE;
  if (state.status === "paused") return state.distance === 0 ? "Skate Runner" : "Paused";
  return laneName(state.lane);
}

function toHud(state: RunnerState): HudSnapshot {
  return {
    status: state.status,
    score: state.score,
    distance: Math.floor(state.distance),
    lane: state.lane,
    trickName: state.trickName,
    showHint: state.status === "playing" && !state.hasInput,
    announce: announceFor(state),
  };
}

function sameHud(a: HudSnapshot, b: HudSnapshot): boolean {
  return (
    a.status === b.status &&
    a.score === b.score &&
    a.distance === b.distance &&
    a.lane === b.lane &&
    a.trickName === b.trickName &&
    a.showHint === b.showHint &&
    a.announce === b.announce
  );
}

export function createRunnerController(options: CreateRunOptions = {}): RunnerController {
  const seed = options.seed ?? 1;
  let state = createRun({ ...options, seed });
  let hud = toHud(state);
  const listeners = new Set<() => void>();

  const publish = (force = false): void => {
    const next = toHud(state);
    if (!force && sameHud(next, hud)) return;
    hud = next;
    for (const listener of listeners) listener();
  };

  const buzz = (events: RunnerEvent[]): void => {
    for (const event of events) playRunnerHaptic(event);
  };

  return {
    getState: () => state,
    getHud: () => hud,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    input: (action) => {
      const tick = applyAction(state, action);
      state = tick.state.hasInput ? tick.state : { ...tick.state, hasInput: true };
      buzz(tick.events);
      publish();
    },
    step: (dt) => {
      let left = dt;
      const events: RunnerEvent[] = [];
      while (left > 1e-6 && state.status === "playing") {
        const slice = Math.min(left, MAX_FRAME_DT);
        const tick = stepRun(state, slice);
        state = tick.state;
        events.push(...tick.events);
        left -= slice;
        if (tick.events.includes("crash")) break;
      }
      buzz(events);
      publish();
    },
    pause: () => {
      if (state.status !== "playing") return;
      state = { ...state, status: "paused" };
      publish();
    },
    resume: () => {
      if (state.status !== "paused") return;
      state = { ...state, status: "playing" };
      publish();
    },
    restart: () => {
      state = createRun({ seed, startPaused: false });
      publish(true);
    },
  };
}
