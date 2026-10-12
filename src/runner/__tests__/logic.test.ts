import { describe, expect, it } from "vitest";
import {
  BASE_SPEED,
  BOX_LENGTH,
  FIRST_ROW_Z,
  LANE_X,
  LANDING_BONUS,
  LATE_LOCK,
  MAX_FRAME_DT,
  MAX_SPEED,
  RAIL_LENGTH,
  SPEED_RAMP,
  TRICK_POINTS,
} from "../constants";
import { createRunnerController, type RunnerController } from "../controller";
import { applyAction, createRun, gradeForLead, laneAfter, stepRun } from "../logic";
import { nextUnit } from "../rng";
import type { Lane, Obstacle } from "../types";

function obstacle(overrides: Partial<Obstacle> & Pick<Obstacle, "kind" | "lane" | "z">): Obstacle {
  return {
    id: 1,
    length: overrides.kind === "rail" ? RAIL_LENGTH : BOX_LENGTH,
    awarded: false,
    resolved: false,
    ...overrides,
  };
}

function rollTo(run: RunnerController, distance: number): void {
  for (let i = 0; i < 500 && run.getState().distance < distance && run.getState().status === "playing"; i += 1) {
    run.step(0.05);
  }
}

describe("lane changes", () => {
  it("moves one lane and stops at the edges", () => {
    expect(laneAfter(1, "left")).toBe(0);
    expect(laneAfter(1, "right")).toBe(2);
    expect(laneAfter(0, "left")).toBe(0);
    expect(laneAfter(2, "right")).toBe(2);
  });

  it("commits the lane on the swipe and ignores a second swipe off the edge", () => {
    const run = createRun({ spawn: false });
    const left = applyAction(run, "left");
    expect(left.state.lane).toBe(0);
    expect(left.events).toEqual([]);
    expect(applyAction(left.state, "left").state).toBe(left.state);
  });

  it("slides visually toward the new lane on the next slice", () => {
    const run = createRunnerController({ spawn: false });
    run.input("left");
    run.step(0.02);
    const mid = run.getState();
    expect(mid.lane).toBe(0);
    expect(mid.x).toBeLessThan(0);
    expect(mid.x).toBeGreaterThan(LANE_X[0]);
    expect(mid.status).toBe("playing");
  });
});

describe("trick timing", () => {
  it("grades a lead in front of the lip as perfect, good, or sloppy", () => {
    expect(gradeForLead(1.2)).toBe("perfect");
    expect(gradeForLead(3.4)).toBe("clean");
    expect(gradeForLead(5.2)).toBe("sketchy");
    expect(gradeForLead(-0.4)).toBe("sketchy");
  });

  it("upgrades a second tap to a nose slide and lets a late second tap stay crooked", () => {
    const first = applyAction(createRun({ spawn: false }), "tap");
    expect(first.state.armed).toBe("crooked");
    expect(applyAction(first.state, "tap").state.armed).toBe("nose");

    let aged = first.state;
    for (let i = 0; i < 8; i += 1) aged = stepRun(aged, MAX_FRAME_DT).state;
    expect(applyAction(aged, "tap").state.armed).toBe("crooked");
  });

  it("locks a timed tap into a perfect crooked grind and holds the lane", () => {
    const z = 8;
    const run = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ id: 4, kind: "rail", lane: 1, z })],
    });
    rollTo(run, z - 1.2);
    run.input("tap");
    rollTo(run, z + 0.3);
    const locked = run.getState();
    expect(locked.onGrind).toBe(true);
    expect(locked.grindTrick).toBe("crooked");
    expect(locked.grade).toBe("perfect");
    expect(locked.trickName).toBe("CROOKED GRIND");
    expect(locked.popup).toBe(TRICK_POINTS.crooked.perfect);
    expect(locked.combo).toBe(1);
    expect(locked.grinds).toBe(1);
    expect(locked.score).toBe(Math.floor(locked.distance) + TRICK_POINTS.crooked.perfect);
    expect(locked.x).toBe(LANE_X[1]);

    run.input("left");
    expect(run.getState().lane).toBe(1);

    rollTo(run, z + RAIL_LENGTH + 0.2);
    const landed = run.getState();
    expect(landed.onGrind).toBe(false);
    expect(landed.grinds).toBe(1);
    expect(landed.lane).toBe(1);
  });

  it("scores a nose slide and a kickflip crooked on their own numbers", () => {
    const nose = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ kind: "rail", lane: 1, z: 8 })],
    });
    rollTo(nose, 8 - 1.2);
    nose.input("tap");
    nose.input("tap");
    expect(nose.getState().armed).toBe("nose");
    rollTo(nose, 8.2);
    expect(nose.getState().grindTrick).toBe("nose");
    expect(nose.getState().grade).toBe("perfect");
    expect(nose.getState().popup).toBe(TRICK_POINTS.nose.perfect);

    const flip = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ kind: "box", lane: 1, z: 8 })],
    });
    rollTo(flip, 8 - 1.2);
    flip.input("flip");
    expect(flip.getState().flip).toBe(0);
    flip.step(0.05);
    expect(flip.getState().flip).toBeGreaterThan(0);
    rollTo(flip, 8.2);
    expect(flip.getState().grindTrick).toBe("kickflip");
    expect(flip.getState().trickName).toBe("KICKFLIP CROOKED");
    expect(flip.getState().grade).toBe("perfect");
    expect(flip.getState().popup).toBe(TRICK_POINTS.kickflip.perfect);
    expect(flip.getState().y).toBeGreaterThan(0);
  });

  it("pays a sloppy make without raising the combo", () => {
    const run = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ kind: "rail", lane: 1, z: 5.5 })],
    });
    run.input("tap");
    rollTo(run, 5.7);
    const locked = run.getState();
    expect(locked.grade).toBe("sketchy");
    expect(locked.combo).toBe(0);
    expect(locked.popup).toBe(TRICK_POINTS.crooked.sketchy);
    expect(locked.score).toBe(Math.floor(locked.distance) + TRICK_POINTS.crooked.sketchy);
  });

  it("multiplies the next good grind and clears the chain on a miss", () => {
    const run = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ id: 1, kind: "rail", lane: 1, z: 8 }), obstacle({ id: 2, kind: "box", lane: 1, z: 20 })],
    });
    rollTo(run, 8 - 1.2);
    run.input("tap");
    rollTo(run, 8 + RAIL_LENGTH + 0.3);
    expect(run.getState().combo).toBe(1);
    expect(run.getState().onGrind).toBe(false);

    rollTo(run, 20 - 1.2);
    run.input("tap");
    rollTo(run, 20.3);
    const chained = run.getState();
    expect(chained.combo).toBe(2);
    expect(chained.popup).toBe(Math.round(TRICK_POINTS.crooked.perfect * 1.5));
    expect(chained.trickPoints).toBe(TRICK_POINTS.crooked.perfect + LANDING_BONUS.clean + chained.popup);

    const missed = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ id: 1, kind: "rail", lane: 1, z: 8 }), obstacle({ id: 2, kind: "box", lane: 1, z: 20 })],
    });
    rollTo(missed, 8 - 1.2);
    missed.input("tap");
    rollTo(missed, 20 + BOX_LENGTH + 0.4);
    expect(missed.getState().onGrind).toBe(false);
    expect(missed.getState().combo).toBe(0);
    expect(missed.getState().misses).toBe(1);
  });
});

describe("what does not lock", () => {
  it("ignores a feature in another lane", () => {
    const run = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ kind: "rail", lane: 0, z: 4 })],
    });
    run.input("tap");
    rollTo(run, 4 + RAIL_LENGTH + 0.4);
    expect(run.getState().onGrind).toBe(false);
    expect(run.getState().misses).toBe(0);
    expect(run.getState().status).toBe("playing");
  });

  it("lets a powerslide roll through a lip without locking", () => {
    const run = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ kind: "rail", lane: 1, z: 3 })],
    });
    run.input("tap");
    run.input("duck");
    expect(run.getState().armed).toBeNull();
    expect(run.getState().duck).toBe(0);
    expect(run.getState().trickName).toBe("POWERSLIDE");
    rollTo(run, 3 + RAIL_LENGTH + 0.4);
    expect(run.getState().onGrind).toBe(false);
    expect(run.getState().misses).toBe(1);
    expect(run.getState().status).toBe("playing");
  });

  it("bails a trick thrown after the late window", () => {
    const z = 2;
    const run = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ kind: "rail", lane: 1, z, length: RAIL_LENGTH })],
    });
    rollTo(run, z + LATE_LOCK + 3);
    expect(run.getState().status).toBe("playing");
    run.input("flip");
    expect(run.getState().crashed).toBe(true);
    run.step(0.2);
    expect(run.getState().status).toBe("gameover");
    expect(run.getState().onGrind).toBe(false);
    run.input("tap");
    expect(run.getState().armed).toBeNull();
  });

  it("ends the run after three missed features in the current lane", () => {
    const run = createRunnerController({
      spawn: false,
      obstacles: [
        obstacle({ id: 1, kind: "box", lane: 1, z: 3 }),
        obstacle({ id: 2, kind: "rail", lane: 1, z: 12 }),
        obstacle({ id: 3, kind: "box", lane: 1, z: 22 }),
      ],
    });
    rollTo(run, 40);
    expect(run.getState().status).toBe("gameover");
    expect(run.getState().misses).toBe(3);
  });
});

describe("score and the street", () => {
  it("counts distance, climbs slowly, and a pause holds the run still", () => {
    const run = createRunnerController({ spawn: false });
    const hud = run.getHud();
    run.step(0.01);
    expect(run.getHud()).toBe(hud);

    run.step(1);
    const moved = run.getState();
    expect(moved.distance).toBeGreaterThan(BASE_SPEED * 0.9);
    expect(moved.distance).toBeLessThan(BASE_SPEED * 1.2);
    expect(moved.speed).toBeGreaterThan(BASE_SPEED);
    expect(moved.speed).toBeLessThan(BASE_SPEED + 0.2);
    expect(moved.score).toBe(Math.floor(moved.distance));

    run.pause();
    const held = run.getState().distance;
    run.step(1);
    expect(run.getState().distance).toBe(held);
    expect(run.getState().status).toBe("paused");
    run.resume();
    run.step(0.1);
    expect(run.getState().distance).toBeGreaterThan(held);

    let fast = createRun({ spawn: false });
    const stepsToCap = Math.ceil((MAX_SPEED - BASE_SPEED) / SPEED_RAMP / MAX_FRAME_DT) + 40;
    for (let i = 0; i < stepsToCap; i += 1) fast = stepRun(fast, MAX_FRAME_DT).state;
    expect(fast.speed).toBe(MAX_SPEED);
  });

  it("restarts a fresh run and ignores input while paused", () => {
    const run = createRunnerController({ spawn: false });
    run.input("tap");
    run.step(0.5);
    run.restart();
    expect(run.getState().distance).toBe(0);
    expect(run.getState().status).toBe("playing");
    expect(run.getState().grinds).toBe(0);
    expect(run.getState().armed).toBeNull();

    const paused = createRun({ startPaused: true, spawn: false });
    expect(stepRun(paused, 0.2).state).toBe(paused);
    expect(applyAction(paused, "tap").events).toEqual([]);
  });

  it("spawns rails and boxes only, with the opening rail out of the center lane", () => {
    const first = stepRun(createRun({ seed: 4 }), MAX_FRAME_DT);
    const again = stepRun(createRun({ seed: 4 }), MAX_FRAME_DT);
    expect(first.state.obstacles.map((item) => [item.kind, item.lane, item.z])).toEqual(
      again.state.obstacles.map((item) => [item.kind, item.lane, item.z]),
    );

    const opening = first.state.obstacles.find((item) => item.z === FIRST_ROW_Z);
    expect(opening).toMatchObject({ kind: "rail", lane: 0 });

    const rows = new Map<number, Set<Lane>>();
    for (const item of first.state.obstacles) {
      expect(item.kind === "rail" || item.kind === "box").toBe(true);
      const lanes = rows.get(item.z) ?? new Set<Lane>();
      lanes.add(item.lane);
      rows.set(item.z, lanes);
    }
    expect(rows.size).toBeGreaterThan(0);
    for (const lanes of rows.values()) expect(lanes.size).toBeLessThan(3);
  });

  it("draws the same random sequence from a seed", () => {
    expect(nextUnit(1)).toEqual(nextUnit(1));
    const sample = nextUnit(1);
    expect(sample.value).toBeGreaterThanOrEqual(0);
    expect(sample.value).toBeLessThan(1);
    expect(sample.seed).not.toBe(1);
  });
});
