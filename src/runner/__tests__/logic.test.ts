import { describe, expect, it } from "vitest";
import {
  BASE_SPEED,
  BOARDSLIDE_BONUS,
  FIRST_ROW_Z,
  LANE_X,
  MAX_FRAME_DT,
  MAX_SPEED,
  OLLIE_DURATION,
  OLLIE_PEAK,
  RAIL_LENGTH,
} from "../constants";
import { createRunnerController } from "../controller";
import { applyAction, createRun, laneAfter, ollieArc, stepRun } from "../logic";
import { nextUnit } from "../rng";
import type { Lane, Obstacle } from "../types";

function obstacle(overrides: Partial<Obstacle> & Pick<Obstacle, "kind" | "lane" | "z">): Obstacle {
  return {
    id: 1,
    length: overrides.kind === "rail" ? RAIL_LENGTH : 0,
    awarded: false,
    resolved: false,
    ...overrides,
  };
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

  it("slides visually toward the new lane without waiting to arrive before a dodge counts", () => {
    const dodged = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ kind: "barrier", lane: 1, z: 6 })],
    });
    dodged.input("left");
    dodged.step(0.02);
    const mid = dodged.getState();
    expect(mid.lane).toBe(0);
    expect(mid.x).toBeLessThan(0);
    expect(mid.x).toBeGreaterThan(LANE_X[0]);
    dodged.step(0.6);
    expect(dodged.getState().status).toBe("playing");

    const intoIt = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ kind: "barrier", lane: 0, z: 6 })],
    });
    intoIt.input("left");
    intoIt.step(0.6);
    expect(intoIt.getState().status).toBe("gameover");
  });
});

describe("ollie arc", () => {
  it("is zero at takeoff and landing and peaks halfway", () => {
    expect(ollieArc(0)).toBe(0);
    expect(ollieArc(OLLIE_DURATION)).toBe(0);
    expect(ollieArc(-0.1)).toBe(0);
    expect(ollieArc(OLLIE_DURATION / 2)).toBeCloseTo(OLLIE_PEAK);
  });

  it("lands once and refuses a second ollie or a duck while airborne", () => {
    const popped = applyAction(createRun({ spawn: false }), "ollie");
    expect(popped.events).toEqual(["ollie"]);
    expect(applyAction(popped.state, "ollie").events).toEqual([]);
    expect(applyAction(popped.state, "duck").events).toEqual([]);

    let state = popped.state;
    const events: string[] = [];
    for (let i = 0; i < 40 && state.ollie >= 0; i += 1) {
      const tick = stepRun(state, MAX_FRAME_DT);
      state = tick.state;
      events.push(...tick.events);
    }
    expect(events.filter((event) => event === "land")).toEqual(["land"]);
    expect(state.ollie).toBe(-1);
    expect(state.y).toBe(0);
  });

  it("clears a cone and still hits a barrier", () => {
    const cone = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ kind: "cone", lane: 1, z: 4 })],
    });
    cone.input("ollie");
    cone.step(0.5);
    expect(cone.getState().status).toBe("playing");

    const missed = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ kind: "cone", lane: 1, z: 4 })],
    });
    missed.step(0.5);
    expect(missed.getState().status).toBe("gameover");

    const wall = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ kind: "barrier", lane: 1, z: 4 })],
    });
    wall.input("ollie");
    wall.step(0.5);
    expect(wall.getState().status).toBe("gameover");
  });
});

describe("powerslide", () => {
  it("ducks under a bar, and standing or ollieing into it crashes", () => {
    const ducked = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ kind: "overhead", lane: 1, z: 3 })],
    });
    ducked.input("duck");
    expect(applyAction(ducked.getState(), "ollie").events).toEqual([]);
    ducked.step(0.35);
    expect(ducked.getState().status).toBe("playing");

    const standing = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ kind: "overhead", lane: 1, z: 3 })],
    });
    standing.step(0.4);
    expect(standing.getState().status).toBe("gameover");

    const popped = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ kind: "overhead", lane: 1, z: 3 })],
    });
    popped.input("ollie");
    popped.step(0.3);
    expect(popped.getState().status).toBe("gameover");
  });
});

describe("rail lock", () => {
  it("locks a grounded approach into a boardslide and ignores lane changes until the rail ends", () => {
    const run = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ id: 4, kind: "rail", lane: 1, z: 4 })],
    });
    run.step(0.4);
    const locked = run.getState();
    expect(locked.onRail).toBe(true);
    expect(locked.trickName).toBe("BOARDSLIDE");
    expect(locked.boardslides).toBe(1);
    expect(locked.score).toBe(Math.floor(locked.distance) + BOARDSLIDE_BONUS);
    expect(locked.x).toBe(LANE_X[1]);

    run.input("left");
    expect(run.getState().lane).toBe(1);

    run.step(1);
    const landed = run.getState();
    expect(landed.onRail).toBe(false);
    expect(landed.boardslides).toBe(1);
    expect(landed.lane).toBe(1);
  });

  it("does not lock from the wrong lane, a duck, or the top of an ollie", () => {
    const otherLane = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ kind: "rail", lane: 0, z: 4 })],
    });
    otherLane.step(0.5);
    expect(otherLane.getState().onRail).toBe(false);

    const ducked = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ kind: "rail", lane: 1, z: 4 })],
    });
    ducked.input("duck");
    ducked.step(0.4);
    expect(ducked.getState().onRail).toBe(false);

    const airborne = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ kind: "rail", lane: 1, z: 3 })],
    });
    airborne.input("ollie");
    airborne.step(0.28);
    expect(airborne.getState().ollie).toBeGreaterThan(0);
    expect(airborne.getState().onRail).toBe(false);
  });
});

describe("score and the street", () => {
  it("counts distance and caps speed, and a pause holds the run still", () => {
    const run = createRunnerController({ spawn: false });
    const hud = run.getHud();
    run.step(0.01);
    expect(run.getHud()).toBe(hud);

    run.step(1);
    expect(run.getState().distance).toBeGreaterThan(BASE_SPEED * 0.9);
    expect(run.getState().score).toBe(Math.floor(run.getState().distance));

    run.pause();
    const held = run.getState().distance;
    run.step(1);
    expect(run.getState().distance).toBe(held);
    expect(run.getState().status).toBe("paused");
    run.resume();
    run.step(0.1);
    expect(run.getState().distance).toBeGreaterThan(held);

    let fast = createRun({ spawn: false });
    for (let i = 0; i < 800; i += 1) fast = stepRun(fast, MAX_FRAME_DT).state;
    expect(fast.speed).toBe(MAX_SPEED);
  });

  it("restarts a fresh run and ignores input while paused or over", () => {
    const run = createRunnerController({ spawn: false });
    run.step(0.5);
    run.restart();
    expect(run.getState().distance).toBe(0);
    expect(run.getState().status).toBe("playing");
    expect(run.getState().boardslides).toBe(0);

    const paused = createRun({ startPaused: true, spawn: false });
    expect(stepRun(paused, 0.2).state).toBe(paused);
    expect(applyAction(paused, "ollie").events).toEqual([]);
  });

  it("spawns a survivable street and keeps the opening cones out of the center lane", () => {
    const first = stepRun(createRun({ seed: 4 }), MAX_FRAME_DT);
    const again = stepRun(createRun({ seed: 4 }), MAX_FRAME_DT);
    expect(first.state.obstacles.map((item) => [item.kind, item.lane, item.z])).toEqual(
      again.state.obstacles.map((item) => [item.kind, item.lane, item.z]),
    );

    const opening = first.state.obstacles.find((item) => item.z === FIRST_ROW_Z);
    expect(opening).toMatchObject({ kind: "cone", lane: 0 });

    const rows = new Map<number, Set<Lane>>();
    for (const item of first.state.obstacles) {
      if (item.kind === "rail") continue;
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

describe("actions while the run is over", () => {
  it("does not ollie after a crash", () => {
    const run = createRunnerController({
      spawn: false,
      obstacles: [obstacle({ kind: "barrier", lane: 1, z: 2 })],
    });
    run.step(0.3);
    expect(run.getState().status).toBe("gameover");
    run.input("ollie");
    expect(run.getState().ollie).toBe(-1);
  });
});
