import { describe, expect, it } from "vitest";
import { createRunnerController } from "../controller";
import { loadBest } from "../ghost";
import { applyAction, createRun, stepRun } from "../logic";
import { gradeTouchdown, ollieArc, popScale } from "../physics";
import { playRunnerSfx, preloadRunnerSfx } from "../sfx";
import { FIXED_DT, LANDING_BONUS, LATE_LOCK, OLLIE_HEIGHT, OLLIE_POP, RAIL_LENGTH, SUGGESTED } from "../tune";
import type { Obstacle } from "../types";

function rail(z: number): Obstacle {
  return { id: 1, kind: "rail", lane: 1, z, length: RAIL_LENGTH, awarded: false, resolved: false };
}

describe("board physics", () => {
  it("ollies on a curve with hang time, then squashes the landing", () => {
    let state = applyAction(createRun({ spawn: false }), "tap").state;
    expect(state.airborne).toBe(true);
    expect(state.vy).toBeGreaterThan(2);
    const heights: number[] = [];
    for (let i = 0; i < 80 && (state.airborne || heights.length < 4); i += 1) {
      state = stepRun(state, FIXED_DT).state;
      heights.push(state.y);
    }
    const peak = Math.max(...heights);
    const peakAt = heights.indexOf(peak);
    const halfway = heights[Math.max(0, Math.floor(peakAt / 2))] ?? 0;
    const apex = ollieArc(OLLIE_POP / ((8 * OLLIE_HEIGHT) / (0.65 * 0.65)), OLLIE_POP).y;
    expect(peak).toBeGreaterThan(OLLIE_HEIGHT * 0.85);
    expect(peak).toBeLessThan(OLLIE_HEIGHT * 1.05);
    expect(apex).toBeCloseTo(OLLIE_HEIGHT, 1);
    expect(halfway).toBeGreaterThan(peak * 0.65);
    expect(state.y).toBe(0);
    expect(state.squash).toBeGreaterThan(0);
  });

  it("grades a flat late pop as perfect and a dumped landing as a bail", () => {
    const flat = { pitch: 0.03, yaw: 0.05, roll: 0.04, balance: 0.1, popped: true, earlyPop: false, flipComplete: 1 };
    expect(gradeTouchdown(flat)).toBe("perfect");
    expect(
      gradeTouchdown({ pitch: 0.03, yaw: 0.2, roll: 0.1, balance: 0, popped: false, earlyPop: false, flipComplete: 1 }),
    ).toBe("clean");
    expect(
      gradeTouchdown({
        pitch: 0.4,
        yaw: 0.2,
        roll: 0.5,
        balance: 0.2,
        popped: true,
        earlyPop: false,
        flipComplete: 1,
      }),
    ).toBe("sketchy");
    expect(
      gradeTouchdown({ pitch: 1.4, yaw: 0, roll: 0, balance: 0, popped: true, earlyPop: false, flipComplete: 1 }),
    ).toBe("bail");
    expect(LANDING_BONUS.perfect).toBeGreaterThan(LANDING_BONUS.clean);
  });

  it("still locks a beat after the lip, and a tap during the freeze pops off after it", () => {
    const z = 6;
    const coyote = createRunnerController({ spawn: false, obstacles: [rail(z)] });
    for (let i = 0; i < 400 && coyote.getState().distance < z + LATE_LOCK + 0.2; i += 1) coyote.step(0.05);
    coyote.input("tap");
    for (let i = 0; i < 30 && !coyote.getState().onGrind && coyote.getState().status === "playing"; i += 1) {
      coyote.step(0.02);
    }
    expect(coyote.getState().onGrind).toBe(true);

    const locked = createRunnerController({ spawn: false, obstacles: [rail(8)] });
    for (let i = 0; i < 400 && locked.getState().distance < 6.8; i += 1) locked.step(0.05);
    locked.input("tap");
    for (let i = 0; i < 40 && !locked.getState().onGrind; i += 1) locked.step(0.02);
    expect(locked.getState().hitStop).toBeGreaterThan(0);
    locked.input("tap");
    expect(locked.getState().onGrind).toBe(true);
    locked.step(0.2);
    expect(locked.getState().onGrind).toBe(false);
    expect(locked.getState().airborne).toBe(true);
  });

  it("bails a grind when balance walks off, and a nudge pulls it back", () => {
    const run = createRunnerController({ spawn: false, obstacles: [rail(8)] });
    for (let i = 0; i < 400 && run.getState().distance < 6.8; i += 1) run.step(0.05);
    run.input("tap");
    for (let i = 0; i < 40 && !run.getState().onGrind; i += 1) run.step(0.02);
    const before = run.getState().balance;
    run.input("left");
    expect(run.getState().lane).toBe(1);
    expect(run.getState().balance).toBeLessThan(before);
    run.getState().balance = 1.3;
    run.getState().grindTime = 3.2;
    run.step(0.05);
    expect(run.getState().crashed).toBe(true);
    run.step(0.2);
    expect(run.getState().status).toBe("gameover");
  });

  it("keeps a short grind from dumping, and a slow flick pops lower", () => {
    const run = createRunnerController({ spawn: false, obstacles: [rail(8)] });
    for (let i = 0; i < 400 && run.getState().distance < 6.8; i += 1) run.step(0.05);
    run.input("tap", { accuracy: 5, speed: 1 });
    for (let i = 0; i < 80 && run.getState().status === "playing"; i += 1) run.step(0.05);
    expect(run.getState().status).toBe("playing");
    const slow = applyAction(createRun({ spawn: false }), "tap", { accuracy: 2, speed: 1 }).state;
    const full = applyAction(createRun({ spawn: false }), "tap", { accuracy: 5, speed: 5 }).state;
    expect(slow.popV0).toBeLessThan(full.popV0);
    expect(full.popV0).toBeCloseTo(OLLIE_POP);
    expect(popScale(1)).toBeLessThan(popScale(5));
    expect(SUGGESTED.laneAssist).toBe(1);
    expect(SUGGESTED.cameraY).toBe(2.2);
  });

  it("takes the same distance at 60Hz as two 120Hz steps", () => {
    const coarse = createRunnerController({ spawn: false });
    coarse.step(1 / 60);
    const fine = createRunnerController({ spawn: false });
    fine.step(1 / 120);
    fine.step(1 / 120);
    expect(coarse.getState().distance).toBeCloseTo(fine.getState().distance, 5);
    expect(coarse.getState().speed).toBeCloseTo(fine.getState().speed, 5);
  });

  it("remembers a personal best on this device and replays it as a ghost", () => {
    localStorage.clear();
    const run = createRunnerController({
      spawn: false,
      obstacles: [
        { id: 1, kind: "box", lane: 1, z: 3, length: 3.6, awarded: false, resolved: false },
        { id: 2, kind: "rail", lane: 1, z: 12, length: RAIL_LENGTH, awarded: false, resolved: false },
        { id: 3, kind: "box", lane: 1, z: 22, length: 3.6, awarded: false, resolved: false },
      ],
    });
    for (let i = 0; i < 500 && run.getState().status === "playing"; i += 1) run.step(0.05);
    expect(run.getState().status).toBe("gameover");
    const saved = loadBest();
    expect(saved.score).toBe(run.getState().score);
    expect(saved.samples.length).toBeGreaterThan(2);

    const next = createRunnerController({ spawn: false });
    expect(next.getGhost().length).toBe(saved.samples.length);
    next.step(0.5);
    expect(next.getGhost()[0]?.d).toBeLessThan(next.getState().distance);
  });
});

describe("runner sfx", () => {
  it("stays quiet where Web Audio is missing", () => {
    expect(() => {
      preloadRunnerSfx();
      playRunnerSfx("pop");
      playRunnerSfx("lock");
      playRunnerSfx("land");
      playRunnerSfx("bail");
    }).not.toThrow();
  });
});
