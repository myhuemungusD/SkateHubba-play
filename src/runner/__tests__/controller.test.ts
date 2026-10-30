import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRunnerController } from "../controller";
import { applyAction, applyLean, stepRun } from "../logic";
import { FIXED_DT, INPUT_BUFFER } from "../constants";
import { pulseGrindHaptic } from "../haptics";
import type { RunnerState } from "../types";

vi.mock("../logic", async (importOriginal) => {
  const real = await importOriginal<typeof import("../logic")>();
  return {
    ...real,
    applyAction: vi.fn(real.applyAction),
    applyLean: vi.fn(real.applyLean),
    stepRun: vi.fn(real.stepRun),
  };
});
vi.mock("../haptics", () => ({ playRunnerHaptic: vi.fn(), pulseGrindHaptic: vi.fn() }));
vi.mock("../sfx", () => ({ playRunnerSfx: vi.fn() }));

const realLogic = await vi.importActual<typeof import("../logic")>("../logic");
const actionMock = vi.mocked(applyAction);
const stepMock = vi.mocked(stepRun);
const leanMock = vi.mocked(applyLean);

/** The next applyAction call returns `prev` patched by `patch`. */
function nextAction(patch: (prev: RunnerState) => Partial<RunnerState>, events: Array<"lock"> = []): void {
  actionMock.mockImplementationOnce((prev) => ({ state: { ...prev, ...patch(prev) }, events }));
}

/** The next applyAction call changes nothing. */
function nextActionNoop(): void {
  actionMock.mockImplementationOnce((prev) => ({ state: prev, events: [] }));
}

const quiet = () => createRunnerController({ spawn: false });

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
  actionMock.mockReset();
  actionMock.mockImplementation(realLogic.applyAction);
  stepMock.mockReset();
  stepMock.mockImplementation(realLogic.stepRun);
});

describe("HUD announcements", () => {
  it("names each lane and the paused title screen", () => {
    expect(createRunnerController({ spawn: false, lane: 0 }).getHud().announce).toBe("Left lane");
    expect(createRunnerController({ spawn: false, lane: 2 }).getHud().announce).toBe("Right lane");
    const title = createRunnerController({ spawn: false, startPaused: true });
    expect(title.getHud().announce).toBe("Skate Runner");
  });

  it("hands an out-of-range lane straight back (exhaustive guard)", () => {
    expect(createRunnerController({ spawn: false, lane: 7 as never }).getHud().announce).toBe(7);
  });

  it("says Paused once the run has moved, and ignores a second pause or a stray resume", () => {
    const run = quiet();
    run.resume();
    expect(run.getState().status).toBe("playing");
    run.step(0.2);
    run.pause();
    run.pause();
    expect(run.getHud().announce).toBe("Paused");
    run.resume();
    expect(run.getState().status).toBe("playing");
  });
});

describe("subscribe and render frames", () => {
  it("notifies listeners until they unsubscribe", () => {
    const run = quiet();
    const listener = vi.fn();
    const stop = run.subscribe(listener);
    run.setStreamlined(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(run.isStreamlined()).toBe(true);
    stop();
    run.setStreamlined(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("interpolates the render frame between fixed steps", () => {
    const run = quiet();
    expect(run.getRenderFrame()).toMatchObject({ distance: 0, x: run.getState().x, speed: run.getState().speed });
    run.step(FIXED_DT * 1.5);
    const frame = run.getRenderFrame();
    expect(frame.distance).toBeGreaterThan(0);
    expect(frame.distance).toBeLessThan(run.getState().distance + 1e-9);
  });
});

describe("streamlined input", () => {
  it("turns a weak tap into a full-strength flip, but not on a grind or for a lane change", () => {
    const run = quiet();
    run.setStreamlined(true);
    run.input("tap", { accuracy: 1, speed: 1 });
    expect(actionMock).toHaveBeenLastCalledWith(expect.anything(), "flip", { accuracy: 5, speed: 5 });

    run.input("left");
    expect(actionMock).toHaveBeenLastCalledWith(expect.anything(), "left", { accuracy: 5, speed: 5 });

    nextAction(() => ({ onGrind: true }), ["lock"]);
    run.input("flip");
    run.input("tap");
    expect(actionMock).toHaveBeenLastCalledWith(expect.anything(), "tap", { accuracy: 5, speed: 5 });
  });
});

describe("lane changes while sliding across", () => {
  it("holds a second lane press until the board settles, then applies it", () => {
    const run = createRunnerController({ spawn: false, lane: 0 });
    run.input("right");
    expect(run.getState().lane).toBe(1);
    run.input("right");
    expect(run.getState().lane).toBe(1);
    for (let i = 0; i < 120 && run.getState().lane === 1; i += 1) run.step(FIXED_DT);
    expect(run.getState().lane).toBe(2);
  });

  it("drops a held press that no longer changes anything, and marks input on one that does", () => {
    const run = createRunnerController({ spawn: false, lane: 0 });
    run.input("right");
    run.input("left");
    nextActionNoop();
    for (let i = 0; i < 120; i += 1) run.step(FIXED_DT);
    expect(run.getState().lane).toBe(1);

    run.input("right");
    run.input("left");
    nextAction(() => ({ lane: 0, hasInput: false }));
    for (let i = 0; i < 120 && run.getState().lane !== 0; i += 1) run.step(FIXED_DT);
    expect(run.getState().lane).toBe(0);
    expect(run.getState().hasInput).toBe(true);
  });
});

describe("buffered trick input", () => {
  it("buffers a tap that did nothing and fires it on the next step", () => {
    const run = quiet();
    nextActionNoop();
    run.input("tap");
    expect(run.getState().airborne).toBe(false);
    run.step(FIXED_DT);
    expect(run.getState().airborne).toBe(true);
    expect(run.getState().hasInput).toBe(true);
  });

  it("marks input when the buffered action returns a fresh state without it", () => {
    const run = quiet();
    nextActionNoop();
    run.input("flip");
    nextAction(() => ({ armed: "kickflip", hasInput: false }));
    run.step(FIXED_DT);
    expect(run.getState().armed).toBe("kickflip");
    expect(run.getState().hasInput).toBe(true);
  });

  it("forgets a buffered tap once the buffer window runs out", () => {
    const run = quiet();
    actionMock.mockImplementation((prev) => ({ state: prev, events: [] }));
    run.input("tap");
    const steps = Math.ceil(INPUT_BUFFER / FIXED_DT) + 2;
    for (let i = 0; i < steps; i += 1) run.step(FIXED_DT);
    const calls = actionMock.mock.calls.length;
    run.step(FIXED_DT);
    expect(actionMock.mock.calls.length).toBe(calls);
  });

  it("does not buffer a dead tap while crashed or paused, nor a lane press at the edge", () => {
    const crashed = quiet();
    stepMock.mockImplementationOnce((prev) => ({ state: { ...prev, crashed: true }, events: [] }));
    crashed.step(FIXED_DT);
    nextActionNoop();
    crashed.input("tap");
    stepMock.mockImplementationOnce((prev) => ({ state: prev, events: [] }));
    const before = actionMock.mock.calls.length;
    crashed.step(FIXED_DT);
    expect(actionMock.mock.calls.length).toBe(before);

    const paused = createRunnerController({ spawn: false, startPaused: true });
    paused.input("tap");
    paused.resume();
    const pausedCalls = actionMock.mock.calls.length;
    paused.step(FIXED_DT);
    expect(actionMock.mock.calls.length).toBe(pausedCalls);

    const edge = createRunnerController({ spawn: false, lane: 0 });
    edge.input("left");
    const edgeCalls = actionMock.mock.calls.length;
    edge.step(FIXED_DT);
    expect(actionMock.mock.calls.length).toBe(edgeCalls);
    expect(edge.getState().lane).toBe(0);
  });

  it("drops the buffer check when a held lane press stopped the run first", () => {
    const run = createRunnerController({ spawn: false, lane: 0 });
    run.input("right");
    run.input("right");
    nextActionNoop();
    run.input("tap");
    nextAction(() => ({ status: "paused" }));
    for (let i = 0; i < 120 && run.getState().status === "playing"; i += 1) run.step(FIXED_DT);
    expect(run.getState().status).toBe("paused");
    expect(actionMock).toHaveBeenCalledTimes(3);
  });
});

describe("game over and personal best", () => {
  it("saves a new best from an input that ends the run, and not from a lower score", () => {
    const run = quiet();
    nextAction(() => ({ status: "gameover", score: 50 }));
    run.input("tap");
    expect(run.getHud()).toMatchObject({ isNewBest: true, best: 50, announce: "Game over. Score 50." });
    expect(run.getGhost().length).toBeGreaterThan(0);
    expect(JSON.parse(localStorage.getItem("skatehubba.runner.best.v1") ?? "{}").score).toBe(50);

    run.restart();
    nextAction(() => ({ status: "gameover", score: 10 }));
    run.input("tap");
    expect(run.getHud()).toMatchObject({ isNewBest: false, best: 50 });
  });

  it("stops stepping on a bail that ends the run", () => {
    const run = quiet();
    stepMock.mockImplementationOnce((prev) => ({
      state: { ...prev, status: "gameover", score: 0 },
      events: ["bail"],
    }));
    run.step(FIXED_DT * 5);
    expect(stepMock).toHaveBeenCalledTimes(1);
    expect(run.getHud().isNewBest).toBe(false);
  });
});

describe("leaning and grind haptics", () => {
  it("applies a clamped lean and pulses haptics while grinding", () => {
    const run = quiet();
    nextAction(() => ({ onGrind: true }), ["lock"]);
    run.input("tap");
    run.setLean(5);
    for (let i = 0; i < 60; i += 1) run.step(FIXED_DT);
    expect(leanMock).toHaveBeenCalledWith(expect.anything(), 1, FIXED_DT);
    expect(pulseGrindHaptic).toHaveBeenCalled();
  });
});
