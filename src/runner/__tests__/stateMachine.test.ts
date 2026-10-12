import { describe, expect, it } from "vitest";
import { createRunnerController } from "../controller";
import { applyAction, createRun, gradeForLead, stepRun } from "../logic";
import {
  COYOTE_TIME,
  FIXED_DT,
  GOOD_MAX,
  GRIND_BUFFER,
  HIT_STOP,
  HIT_STOP_BAIL,
  HIT_STOP_MAX,
  HIT_STOP_PERFECT,
  LAND_PRESS_WINDOW,
  LATE_LOCK,
  PERFECT_MAX,
  PERFECT_MIN,
  RAIL_LENGTH,
  TRICK_BUFFER,
  coyoteDistance,
} from "../tune";
import type { RunnerState } from "../types";

function rail(z: number) {
  return { id: 1, kind: "rail" as const, lane: 1 as const, z, length: RAIL_LENGTH, awarded: false, resolved: false };
}

/** Rolling, air, grind, the landing after a grind, bail, and the ended run. */
function phase(state: RunnerState): "rolling" | "air" | "grind" | "landing" | "bail" | "over" {
  if (state.status === "gameover") return "over";
  if (state.crashed) return "bail";
  if (state.onGrind) return "grind";
  if (state.pendingLanding) return "landing";
  if (state.airborne) return "air";
  return "rolling";
}

function rollTo(state: RunnerState, distance: number): RunnerState {
  let next = state;
  for (let i = 0; i < 2000 && next.distance < distance && next.status === "playing" && !next.crashed; i += 1) {
    next = stepRun(next, FIXED_DT).state;
  }
  return next;
}

describe("physics state machine", () => {
  it("walks rolling, air, grind, pop-off, and back to rolling", () => {
    let state = createRun({ spawn: false, obstacles: [rail(12)] });
    expect(phase(state)).toBe("rolling");

    state = applyAction(state, "tap").state;
    expect(phase(state)).toBe("air");
    for (let i = 0; i < 90 && phase(state) === "air"; i += 1) state = stepRun(state, FIXED_DT).state;
    expect(phase(state)).toBe("rolling");

    state = rollTo(state, 10.2);
    const lead = 12 - state.distance;
    expect(lead).toBeGreaterThanOrEqual(PERFECT_MIN);
    expect(lead).toBeLessThanOrEqual(PERFECT_MAX);
    state = applyAction(state, "tap").state;
    for (let i = 0; i < 80 && phase(state) !== "grind"; i += 1) state = stepRun(state, FIXED_DT).state;
    expect(phase(state)).toBe("grind");
    expect(state.grade).toBe("perfect");
    expect(state.hitStop).toBeCloseTo(HIT_STOP, 5);

    for (let i = 0; i < 20 && state.hitStop > 0; i += 1) state = stepRun(state, FIXED_DT).state;
    state = applyAction(state, "tap").state;
    expect(phase(state)).toBe("landing");
    for (let i = 0; i < 120 && (state.pendingLanding || state.airborne); i += 1) {
      state = stepRun(state, FIXED_DT).state;
    }
    expect(phase(state)).toBe("rolling");
  });

  it("slides off the end of a rail into a landing, without a tap", () => {
    let state = rollTo(createRun({ spawn: false, obstacles: [rail(8)] }), 6.4);
    state = applyAction(state, "tap").state;
    for (let i = 0; i < 40 && phase(state) !== "grind"; i += 1) state = stepRun(state, FIXED_DT).state;
    expect(phase(state)).toBe("grind");
    for (let i = 0; i < 400 && phase(state) === "grind"; i += 1) state = stepRun(state, FIXED_DT).state;
    expect(phase(state)).toBe("landing");
    for (let i = 0; i < 120 && (state.pendingLanding || state.airborne); i += 1) {
      state = stepRun(state, FIXED_DT).state;
    }
    expect(phase(state)).toBe("rolling");
    expect(state.grade).toBe("clean");
  });

  it("pops off a grind on the same step as the tap, including during the lock freeze", () => {
    const run = createRunnerController({ spawn: false, obstacles: [rail(8)] });
    for (let i = 0; i < 800 && run.getState().distance < 6.5; i += 1) run.step(FIXED_DT);
    run.input("tap");
    for (let i = 0; i < 30 && !run.getState().onGrind; i += 1) run.step(FIXED_DT);
    expect(run.getState().onGrind).toBe(true);
    expect(run.getState().hitStop).toBeGreaterThan(0);
    run.input("tap");
    expect(run.getState().onGrind).toBe(false);
    expect(run.getState().airborne).toBe(true);
  });
});

describe("timing windows", () => {
  it("grades the perfect band, the clean band, and everything outside them", () => {
    expect(gradeForLead(PERFECT_MIN)).toBe("perfect");
    expect(gradeForLead(PERFECT_MAX)).toBe("perfect");
    expect(gradeForLead(0)).toBe("clean");
    expect(gradeForLead(GOOD_MAX)).toBe("clean");
    expect(gradeForLead(GOOD_MAX + 0.001)).toBe("sketchy");
    expect(gradeForLead(-0.2)).toBe("sketchy");
    expect(GRIND_BUFFER).toBeGreaterThanOrEqual(TRICK_BUFFER);
    expect(LAND_PRESS_WINDOW).toBeLessThanOrEqual(TRICK_BUFFER);
    expect(COYOTE_TIME).toBeGreaterThan(0);
    expect(HIT_STOP).toBeLessThan(HIT_STOP_PERFECT);
    expect(HIT_STOP_PERFECT).toBeLessThan(HIT_STOP_BAIL);
    expect(HIT_STOP_BAIL).toBeLessThanOrEqual(HIT_STOP_MAX);
  });

  it("still locks inside coyote time and bails once that window is gone", () => {
    const z = 8;
    const made = createRunnerController({ spawn: false, obstacles: [rail(z)] });
    for (let i = 0; i < 2000 && made.getState().distance < z + LATE_LOCK + 0.15; i += 1) made.step(FIXED_DT);
    const madeState = made.getState();
    expect(madeState.distance).toBeGreaterThan(z);
    expect(madeState.distance).toBeLessThan(z + LATE_LOCK + coyoteDistance(madeState.speed));
    madeState.airborne = true;
    madeState.y = 0.4;
    madeState.vy = -2;
    madeState.popV0 = 0;
    made.input("tap");
    made.step(FIXED_DT);
    expect(made.getState().onGrind).toBe(true);
    expect(made.getState().grade).toBe("sketchy");

    const missed = createRunnerController({ spawn: false, obstacles: [rail(z)] });
    for (
      let i = 0;
      i < 2000 && missed.getState().distance <= z + LATE_LOCK + coyoteDistance(missed.getState().speed) + 0.35;
      i += 1
    ) {
      missed.step(FIXED_DT);
    }
    expect(missed.getState().distance).toBeLessThan(z + RAIL_LENGTH);
    missed.input("tap");
    expect(missed.getState().crashed).toBe(true);
    expect(missed.getState().status).toBe("playing");
    expect(missed.getState().hitStop).toBeCloseTo(HIT_STOP_BAIL, 5);
    missed.step(FIXED_DT);
    expect(missed.getState().status).toBe("playing");
    missed.step(0.2);
    expect(missed.getState().status).toBe("gameover");
  });
});
