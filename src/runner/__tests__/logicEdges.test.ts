import { describe, expect, it } from "vitest";
import { applyAction, applyLean, createRun, stepRun } from "../logic";
import { gradeTouchdown, integrateMotion, timeToGround } from "../physics";
import {
  ARM_RANGE,
  BALANCE_NUDGE,
  FALL_GRAVITY_SCALE,
  FIXED_DT,
  FLIP_DURATION,
  FLIP_SLOP,
  GRIND_MIN_SPEED,
  LAND_CLEAN,
  LAND_PERFECT,
  RAIL_LENGTH,
  TRICK_POWERSLIDE,
} from "../tune";
import type { Obstacle, RunnerState } from "../types";

const rail = (z: number, over: Partial<Obstacle> = {}): Obstacle => ({
  id: 1,
  kind: "rail",
  lane: 1,
  z,
  length: RAIL_LENGTH,
  awarded: false,
  resolved: false,
  ...over,
});

/** A quiet, empty street with the given overrides applied. */
const run = (over: Partial<RunnerState> = {}): RunnerState => ({ ...createRun({ spawn: false }), ...over });

/** Locked on a rail that starts behind the board. */
const grinding = (over: Partial<RunnerState> = {}): RunnerState =>
  run({
    distance: 2,
    onGrind: true,
    grindId: 1,
    grindTrick: "crooked",
    obstacles: [rail(1, { awarded: true })],
    ...over,
  });

describe("applyAction edges", () => {
  it("hands an unknown runtime action straight back (exhaustive guard)", () => {
    expect(applyAction(run(), "spin" as never)).toBe("spin");
  });

  it("nudges the balance both ways on a grind", () => {
    expect(applyAction(grinding(), "left").state.balance).toBeCloseTo(-BALANCE_NUDGE);
    expect(applyAction(grinding(), "right").state.balance).toBeCloseTo(BALANCE_NUDGE);
  });

  it("pops off a rail whose feature is already gone as an early pop", () => {
    const tick = applyAction(grinding({ obstacles: [] }), "tap");
    expect(tick.events).toEqual(["pop"]);
    expect(tick.state.earlyPop).toBe(true);
  });

  it("starts a kickflip in the air without a second pop impulse", () => {
    const air = run({ airborne: true, y: 1, vy: 2, popV0: 4, popAge: 0.1 });
    const tick = applyAction(air, "flip");
    expect(tick.events).toEqual(["pop"]);
    expect(tick.state.flip).toBe(0);
    expect(tick.state.rollVel).toBe(2.4);
    expect(tick.state.vy).toBe(2);
  });

  it("re-arms a crooked in the air without popping again", () => {
    const tick = applyAction(run({ airborne: true, y: 1, vy: 2, popV0: 4 }), "tap");
    expect(tick.events).toEqual([]);
    expect(tick.state.armed).toBe("crooked");
  });

  it("times a landing press during exit coyote and clears an early pop", () => {
    const sliding = run({ airborne: true, pendingLanding: true, exitCoyote: 0.1, earlyPop: true, y: 2, vy: 3 });
    const tick = applyAction(sliding, "tap");
    expect(tick.events).toEqual([]);
    expect(tick.state.popped).toBe(true);
    expect(tick.state.earlyPop).toBe(false);
    expect(tick.state.timedLand).toBe(false);
  });

  it("keeps an early pop when the press lands inside the trick buffer", () => {
    const falling = run({ airborne: true, pendingLanding: true, earlyPop: true, y: 0.01, vy: -3 });
    const tick = applyAction(falling, "tap");
    expect(tick.state.earlyPop).toBe(true);
    expect(tick.state.timedLand).toBe(true);
  });

  it("does not powerslide on a grind or mid-slide, and keeps a showing trick name", () => {
    const locked = grinding();
    expect(applyAction(locked, "duck").state).toBe(locked);
    const sliding = run({ duck: 0.1 });
    expect(applyAction(sliding, "duck").state).toBe(sliding);

    const showing = applyAction(run({ trickName: "Crooked", trickTime: 0.4 }), "duck");
    expect(showing.events).toEqual(["powerslide"]);
    expect(showing.state.trickName).toBe("Crooked");
    expect(showing.state.trickTime).toBe(0.4);
    expect(applyAction(run(), "duck").state.trickName).toBe(TRICK_POWERSLIDE);
  });
});

describe("tap during a hit-stop freeze", () => {
  it("is swallowed while the board is not grinding", () => {
    const frozen = run({ hitStop: 0.05 });
    expect(applyAction(frozen, "tap")).toEqual({ state: frozen, events: [] });
  });
});

describe("applyLean", () => {
  it("only leans a locked board with a real lean and time step", () => {
    const rolling = run();
    expect(applyLean(rolling, 1, FIXED_DT)).toBe(rolling);
    const locked = grinding({ balanceVel: 1 });
    expect(applyLean(locked, 0, FIXED_DT)).toBe(locked);
    expect(applyLean(locked, 1, 0)).toBe(locked);
    const leaned = applyLean(locked, -1, 10);
    expect(leaned.balance).toBe(-1.4);
    expect(leaned.balanceVel).toBeCloseTo(0.35);
  });
});

describe("stepRun edges", () => {
  it("does nothing for a zero or negative time step", () => {
    const state = run();
    expect(stepRun(state, 0).state).toBe(state);
    expect(stepRun(state, -1).state).toBe(state);
  });

  it("does not lock when the trick was armed out of range", () => {
    const state = run({ armed: "crooked", armedDistance: -ARM_RANGE - 1, distance: 0.5, obstacles: [rail(0.6)] });
    const tick = stepRun(state, FIXED_DT);
    expect(tick.events).not.toContain("lock");
    expect(tick.state.armed).toBeNull();
  });

  it("does not lock onto a feature whose window closed before the arm", () => {
    const state = run({ armed: "crooked", armedDistance: 50, distance: 1, obstacles: [rail(0.9)] });
    expect(stepRun(state, FIXED_DT).events).not.toContain("lock");
  });

  it("brings a slow board up to grind speed on the lock and keeps a flip blending", () => {
    const state = run({
      armed: "kickflip",
      flip: 0.2,
      armedDistance: 0,
      distance: 0.9,
      speed: 1,
      obstacles: [rail(1)],
    });
    let tick = stepRun(state, FIXED_DT);
    for (let i = 0; i < 20 && !tick.events.includes("lock"); i += 1) tick = stepRun(tick.state, FIXED_DT);
    expect(tick.events).toContain("lock");
    expect(tick.state.speed).toBeGreaterThanOrEqual(GRIND_MIN_SPEED);
    expect(tick.state.flipBlend).toBeGreaterThan(0);
    expect(tick.state.flip).toBeGreaterThanOrEqual(0);

    let after = { ...tick.state, hitStop: 0 };
    for (let i = 0; i < 60 && after.flipBlend > 0; i += 1) after = stepRun(after, FIXED_DT).state;
    expect(after.flipBlend).toBe(0);
    expect(after.flip).toBe(-1);
  });

  it("holds the board in place on a grind whose feature vanished", () => {
    const start = grinding({ obstacles: [], x: 0.3 });
    const tick = stepRun(start, FIXED_DT);
    expect(tick.state.onGrind).toBe(true);
    expect(tick.state.x).toBe(0.3);
    expect(tick.state.distance).toBeGreaterThan(start.distance);
  });

  it("adds flip slop once when a sloppy flick finishes its flip in the air", () => {
    const air = run({ airborne: true, y: 2, vy: 1, popV0: 6, popAge: 0.1, flip: FLIP_DURATION, flickAccuracy: 1 });
    const tick = stepRun(air, FIXED_DT);
    expect(tick.state.flipSlopApplied).toBe(true);
    expect(tick.state.roll).not.toBe(0);
    const again = stepRun(tick.state, FIXED_DT);
    expect(again.state.flipSlopApplied).toBe(true);
    expect(FLIP_SLOP).toBeGreaterThan(0);
  });

  it("bails a pending landing that touches down on a wild angle", () => {
    const wild = run({ airborne: true, pendingLanding: true, y: 0.001, vy: -2, pitch: 2, popV0: 0 });
    const tick = stepRun(wild, FIXED_DT);
    expect(tick.events).toContain("bail");
    expect(tick.state.crashed).toBe(true);
  });

  it("pays a perfect landing for a pressed clean landing with an unfinished-flip check", () => {
    const pressed = run({
      airborne: true,
      pendingLanding: true,
      timedLand: true,
      popped: true,
      earlyPop: true,
      y: 0.001,
      vy: -2,
      popV0: 0,
      flip: FLIP_DURATION,
    });
    const tick = stepRun(pressed, FIXED_DT);
    expect(tick.events).toContain("land");
    expect(tick.state.grade).toBe("perfect");
    expect(tick.state.hitStop).toBeGreaterThan(0);
    expect(tick.state.speed).toBeGreaterThan(pressed.speed);
  });
});

describe("spawned streets", () => {
  it("sometimes pairs a rail with a box in the same row", () => {
    const pairs = new Set<string>();
    for (let seed = 1; seed < 80; seed += 1) {
      let state = createRun({ seed });
      for (let i = 0; i < 4; i += 1) state = { ...stepRun(state, FIXED_DT).state, status: "playing" };
      const rows = new Map<number, string[]>();
      for (const obstacle of state.obstacles) rows.set(obstacle.z, [...(rows.get(obstacle.z) ?? []), obstacle.kind]);
      for (const kinds of rows.values()) if (kinds.length === 2) pairs.add(kinds.join("+"));
    }
    expect(pairs).toEqual(new Set(["rail+box", "box+rail"]));
  });
});

describe("physics edges", () => {
  it("falls back to the default fall scale for a non-positive scale", () => {
    const base = { airborne: true, y: 1, vy: -1, popV0: 0 };
    expect(timeToGround(run({ ...base, fallScale: 0 }))).toBeCloseTo(
      timeToGround(run({ ...base, fallScale: FALL_GRAVITY_SCALE })),
    );
  });

  it("reports zero for a grounded board and one for a rising board without pop", () => {
    expect(timeToGround(run())).toBe(0);
    expect(timeToGround(run({ y: 0, airborne: true, vy: -1 }))).toBe(0);
    expect(timeToGround(run({ y: 1, airborne: false, vy: 2 }))).toBe(1);
  });

  it("grades a popped landing between perfect and clean, and a loose one sketchy", () => {
    const sample = { pitch: 0, yaw: 0, roll: 0, balance: 0, popped: true, earlyPop: true, flipComplete: 1 };
    expect(gradeTouchdown(sample)).toBe("clean");
    expect(gradeTouchdown({ ...sample, earlyPop: false, roll: (LAND_PERFECT + LAND_CLEAN) / 2 })).toBe("clean");
    expect(gradeTouchdown({ ...sample, balance: 0.8 })).toBe("sketchy");
    expect(gradeTouchdown({ ...sample, roll: LAND_CLEAN + 0.05 })).toBe("sketchy");
  });

  it("holds the crooked pose on a grind with no recorded trick", () => {
    const state = grinding({ grindTrick: null });
    integrateMotion(state, FIXED_DT);
    expect(state.airborne).toBe(false);
  });

  it("lets the grind magnet lift a grounded, armed board toward a rail just ahead", () => {
    const state = run({ armed: "crooked", grindAssist: 100, y: 0.3, obstacles: [rail(0.2)] });
    integrateMotion(state, FIXED_DT);
    expect(state.y).toBeGreaterThan(0);
  });

  it("caps a rightward lane change at the stopping speed", () => {
    const state = run({ lane: 2, x: 0, vx: 50 });
    integrateMotion(state, FIXED_DT);
    expect(state.vx).toBeLessThan(50);
  });

  it("bounces a hard landing without a pop arc", () => {
    const state = run({ airborne: true, y: 0.01, vy: -20, popV0: 0 });
    expect(integrateMotion(state, FIXED_DT).touched).toBe(true);
    expect(state.vy).toBeGreaterThan(0);
    expect(state.airborne).toBe(true);
  });
});
