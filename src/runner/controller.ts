import { boardPose } from "./boardPose";
import {
  FIXED_DT,
  GRIND_ASSIST_DEFAULT,
  GRIND_PULSE,
  INPUT_BUFFER,
  LANE_X,
  feelPresetById,
  multiplierFor,
  type FeelPresetId,
} from "./constants";
import { loadBest, noteSample, saveBest, type GhostSample, type PersonalBest } from "./ghost";
import { playRunnerHaptic, pulseGrindHaptic } from "./haptics";
import { applyAction, applyLean, createRun, stepRun, type CreateRunOptions } from "./logic";
import { playRunnerSfx } from "./sfx";
import type { Action, FlickGrade, Grade, Lane, RunnerEvent, RunnerState, RunnerStatus, Trick } from "./types";

const FULL_FLICK: FlickGrade = { accuracy: 5, speed: 5 };

export interface HudSnapshot {
  status: RunnerStatus;
  score: number;
  distance: number;
  lane: Lane;
  trickName: string | null;
  grade: Grade | null;
  popup: number;
  combo: number;
  multiplier: number;
  armed: Trick | null;
  showHint: boolean;
  announce: string;
  onGrind: boolean;
  balance: number;
  best: number;
  isNewBest: boolean;
  streamlined: boolean;
}

interface RenderFrame {
  distance: number;
  x: number;
  y: number;
  speed: number;
  pitch: number;
  yaw: number;
  roll: number;
  spin: number;
  squash: number;
}

export interface RunnerController {
  getState: () => RunnerState;
  getHud: () => HudSnapshot;
  getRenderFrame: () => RenderFrame;
  getGhost: () => readonly GhostSample[];
  subscribe: (listener: () => void) => () => void;
  input: (action: Action, flick?: FlickGrade) => void;
  setStreamlined: (streamlined: boolean) => void;
  isStreamlined: () => boolean;
  /** -1..1 while a finger or key is held. Zero clears it. */
  setLean: (lean: number) => void;
  setFeelPreset: (id: FeelPresetId) => void;
  feelPreset: () => FeelPresetId;
  setGrindAssist: (assist: number) => void;
  grindAssist: () => number;
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
  if (state.trickName && (state.onGrind || state.trickTime > 0)) return state.trickName;
  if (state.status === "paused") return state.distance === 0 ? "Skate Runner" : "Paused";
  return laneName(state.lane);
}

function toHud(state: RunnerState, best: number, isNewBest: boolean, streamlined: boolean): HudSnapshot {
  return {
    status: state.status,
    score: state.score,
    distance: Math.floor(state.distance),
    lane: state.lane,
    trickName: state.trickName,
    grade: state.grade,
    popup: state.popup,
    combo: state.combo,
    multiplier: multiplierFor(state.combo),
    armed: state.armed,
    showHint: state.status === "playing" && !state.hasInput,
    announce: announceFor(state),
    onGrind: state.onGrind,
    balance: Math.round(state.balance * 20) / 20,
    best,
    isNewBest,
    streamlined,
  };
}

function sameHud(a: HudSnapshot, b: HudSnapshot): boolean {
  return (
    a.status === b.status &&
    a.score === b.score &&
    a.distance === b.distance &&
    a.lane === b.lane &&
    a.trickName === b.trickName &&
    a.grade === b.grade &&
    a.popup === b.popup &&
    a.combo === b.combo &&
    a.multiplier === b.multiplier &&
    a.armed === b.armed &&
    a.showHint === b.showHint &&
    a.announce === b.announce &&
    a.onGrind === b.onGrind &&
    a.balance === b.balance &&
    a.best === b.best &&
    a.isNewBest === b.isNewBest &&
    a.streamlined === b.streamlined
  );
}

function frameFrom(state: RunnerState): RenderFrame {
  const pose = boardPose(state);
  return {
    distance: state.distance,
    x: state.x,
    y: pose.y,
    speed: state.speed,
    pitch: pose.pitch,
    yaw: pose.yaw,
    roll: pose.roll,
    spin: pose.spin,
    squash: state.squash,
  };
}

function mixFrame(from: RenderFrame, to: RenderFrame, alpha: number): RenderFrame {
  const blend = (a: number, b: number): number => a + (b - a) * alpha;
  return {
    distance: blend(from.distance, to.distance),
    x: blend(from.x, to.x),
    y: blend(from.y, to.y),
    speed: blend(from.speed, to.speed),
    pitch: blend(from.pitch, to.pitch),
    yaw: blend(from.yaw, to.yaw),
    roll: blend(from.roll, to.roll),
    spin: blend(from.spin, to.spin),
    squash: blend(from.squash, to.squash),
  };
}

function buzz(events: RunnerEvent[], grade: Grade | null): void {
  for (const event of events) {
    playRunnerHaptic(event, event === "land" ? grade : null);
    playRunnerSfx(event);
  }
}

export function createRunnerController(options: CreateRunOptions = {}): RunnerController {
  const seed = options.seed ?? 1;
  let state = createRun({ ...options, seed });
  let best: PersonalBest = loadBest();
  let isNewBest = false;
  let streamlined = false;
  let feel: FeelPresetId = "street";
  let assist = GRIND_ASSIST_DEFAULT;
  let hud = toHud(state, best.score, isNewBest, streamlined);
  let accumulator = 0;
  let lean = 0;
  let lanePending: "left" | "right" | null = null;
  let nextGrindPulse = 0;
  let queued: { action: Action; flick: FlickGrade; left: number } | null = null;
  let previous = frameFrom(state);
  let current = previous;
  let render = current;
  const trail: GhostSample[] = [];
  const listeners = new Set<() => void>();

  const publish = (force = false): void => {
    const next = toHud(state, best.score, isNewBest, streamlined);
    if (!force && sameHud(next, hud)) return;
    hud = next;
    for (const listener of listeners) listener();
  };

  const commitBest = (): void => {
    if (state.score <= best.score || state.score <= 0) {
      isNewBest = false;
      return;
    }
    noteSample(trail, state.distance, state.x, state.y);
    best = { score: state.score, distance: state.distance, samples: trail.slice() };
    isNewBest = true;
    saveBest(best);
  };

  const consumeQueue = (events: RunnerEvent[]): void => {
    if (!queued || state.status !== "playing") return;
    queued.left -= FIXED_DT;
    const tick = applyAction(state, queued.action, queued.flick);
    if (tick.state !== state) {
      state = tick.state.hasInput ? tick.state : { ...tick.state, hasInput: true };
      events.push(...tick.events);
      queued = null;
      return;
    }
    if (queued.left <= 0) queued = null;
  };

  return {
    getState: () => state,
    getHud: () => hud,
    getRenderFrame: () => render,
    getGhost: () => best.samples,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    input: (action, flick) => {
      let nextAction = action;
      let nextFlick = flick ?? FULL_FLICK;
      if (streamlined && !state.onGrind && (action === "tap" || action === "flip")) {
        nextAction = "flip";
        nextFlick = FULL_FLICK;
      }
      if (
        (nextAction === "left" || nextAction === "right") &&
        !state.onGrind &&
        (Math.abs(state.x - LANE_X[state.lane]) > 0.02 || lanePending !== null)
      ) {
        lanePending = nextAction;
        return;
      }
      const tick = applyAction(state, nextAction, nextFlick);
      if (
        tick.state === state &&
        state.status === "playing" &&
        !state.crashed &&
        (nextAction === "tap" || nextAction === "flip")
      ) {
        queued = { action: nextAction, flick: nextFlick, left: INPUT_BUFFER };
        return;
      }
      queued = null;
      const wasPlaying = state.status === "playing";
      state = tick.state.hasInput ? tick.state : { ...tick.state, hasInput: true };
      if (wasPlaying && state.status === "gameover") commitBest();
      if (tick.events.includes("lock")) nextGrindPulse = state.elapsed + GRIND_PULSE;
      buzz(tick.events, state.grade);
      publish();
    },
    setStreamlined: (next) => {
      streamlined = next;
      publish(true);
    },
    isStreamlined: () => streamlined,
    setLean: (next) => {
      lean = Math.max(-1, Math.min(1, next));
    },
    step: (dt) => {
      if (state.status !== "playing") {
        publish();
        return;
      }
      const capped = Math.min(Math.max(dt, 0), 1);
      accumulator += capped;
      const events: RunnerEvent[] = [];
      let guard = 0;
      while (accumulator >= FIXED_DT - 1e-8 && state.status === "playing" && guard < 150) {
        guard += 1;
        accumulator -= FIXED_DT;
        previous = current;
        const was = state.status;
        if (lanePending && !state.onGrind && Math.abs(state.x - LANE_X[state.lane]) <= 0.02) {
          const pending = lanePending;
          lanePending = null;
          const laneTick = applyAction(state, pending);
          if (laneTick.state !== state) {
            state = laneTick.state.hasInput ? laneTick.state : { ...laneTick.state, hasInput: true };
            events.push(...laneTick.events);
          }
        }
        consumeQueue(events);
        if (lean !== 0 && state.onGrind) state = applyLean(state, lean, FIXED_DT);
        const tick = stepRun(state, FIXED_DT);
        state = tick.state;
        events.push(...tick.events);
        current = frameFrom(state);
        noteSample(trail, state.distance, state.x, state.y);
        if (was === "playing" && state.status === "gameover") commitBest();
        if (tick.events.includes("lock")) nextGrindPulse = state.elapsed + GRIND_PULSE;
        if (state.onGrind && state.elapsed >= nextGrindPulse) {
          pulseGrindHaptic();
          nextGrindPulse = state.elapsed + GRIND_PULSE;
        }
        if (tick.events.includes("bail")) break;
      }
      const alpha = accumulator <= 0 ? 0 : Math.min(1, accumulator / FIXED_DT);
      render = mixFrame(previous, current, alpha);
      buzz(events, state.grade);
      publish();
    },
    pause: () => {
      if (state.status !== "playing") return;
      accumulator = 0;
      state = { ...state, status: "paused" };
      publish();
    },
    resume: () => {
      if (state.status !== "paused") return;
      accumulator = 0;
      state = { ...state, status: "playing" };
      publish();
    },
    setFeelPreset: (id) => {
      feel = id;
      const preset = feelPresetById(id);
      assist = preset.grindAssist;
      state = { ...state, fallScale: preset.fallGravity, grindAssist: assist };
      publish(true);
    },
    feelPreset: () => feel,
    setGrindAssist: (value) => {
      assist = Math.max(0, Math.min(100, value));
      state = { ...state, grindAssist: assist };
      publish(true);
    },
    grindAssist: () => assist,
    restart: () => {
      const preset = feelPresetById(feel);
      state = createRun({
        seed,
        startPaused: false,
        fallScale: preset.fallGravity,
        grindAssist: assist,
      });
      accumulator = 0;
      lean = 0;
      queued = null;
      lanePending = null;
      nextGrindPulse = 0;
      isNewBest = false;
      trail.length = 0;
      previous = frameFrom(state);
      current = previous;
      render = current;
      publish(true);
    },
  };
}
