import { describe, expect, it } from "vitest";
import { applyAction, createRun, stepRun } from "../logic";
import { curveSample, grindDirectionOk, railBowOffset } from "../railCurve";
import { COPING_OFFSET, FIXED_DT, GRIND_DIR_DOT, LANE_X, RAIL_BOW, RAIL_LENGTH, RAIL_Y } from "../tune";
import type { Obstacle } from "../types";

function rail(z: number): Obstacle {
  return { id: 1, kind: "rail", lane: 1, z, length: RAIL_LENGTH, awarded: false, resolved: false };
}

describe("curve rails", () => {
  it("bows a rail in the middle and keeps both lips on the lane", () => {
    const feature = rail(10);
    expect(curveSample(feature, 0).x).toBeCloseTo(LANE_X[1]);
    expect(curveSample(feature, RAIL_LENGTH).x).toBeCloseTo(LANE_X[1]);
    expect(curveSample(feature, RAIL_LENGTH / 2).x).toBeCloseTo(LANE_X[1] + RAIL_BOW);
    expect(curveSample(feature, 0).y).toBe(RAIL_Y);
    expect(railBowOffset(0.5)).toBeCloseTo(RAIL_BOW);
  });

  it("puts a ledge grind on the coping, and rejects a sideways approach", () => {
    const box: Obstacle = { id: 2, kind: "box", lane: 1, z: 4, length: 3.6, awarded: false, resolved: false };
    const sample = curveSample(box, 0);
    expect(sample.x).toBeCloseTo(LANE_X[1] + COPING_OFFSET);
    expect(sample.tz).toBe(1);
    const forward = curveSample(rail(0), 0);
    expect(grindDirectionOk(0, 6, forward.tx, forward.tz)).toBe(true);
    expect(grindDirectionOk(-8, 0.2, forward.tx, forward.tz)).toBe(false);
    expect(GRIND_DIR_DOT).toBeCloseTo(0.25);
  });

  it("refuses a lock while rising, locks on the way down, and keeps a live flip", () => {
    const z = 8;
    let rising = applyAction(createRun({ spawn: false, obstacles: [rail(z)] }), "tap").state;
    rising = {
      ...rising,
      distance: z - 0.02,
      armedDistance: z - 1,
      y: 0.5,
      vy: 2,
      airborne: true,
      popV0: 0,
      speed: 6,
      vx: 0,
    };
    expect(stepRun(rising, FIXED_DT).state.onGrind).toBe(false);

    let falling = { ...rising, vy: -2, flip: 0.12 };
    falling = stepRun(falling, FIXED_DT).state;
    expect(falling.onGrind).toBe(true);
    expect(falling.crashed).toBe(false);
    expect(falling.flipBlend).toBeGreaterThan(0);

    let sideways = { ...rising, x: 1.2, vy: -2, vx: -10, speed: 1, distance: z - 0.005, flip: -1 };
    sideways = stepRun(sideways, FIXED_DT).state;
    expect(sideways.onGrind).toBe(false);
  });
});
