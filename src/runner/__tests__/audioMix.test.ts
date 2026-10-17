import { describe, expect, it } from "vitest";
import { mixLevels } from "../audioMix";
import { BASE_SPEED, MAX_SPEED, ROLL_GAIN_HI, ROLL_GAIN_LO } from "../tune";

const rolling = {
  speed: BASE_SPEED,
  onGrind: false,
  airborne: false,
  duck: -1,
  status: "playing",
  grindTime: 0,
  balance: 0,
};

describe("layered audio", () => {
  it("raises the roll with speed and ducks it in the air", () => {
    const slow = mixLevels(rolling);
    const fast = mixLevels({ ...rolling, speed: MAX_SPEED });
    expect(slow.rollGain).toBeCloseTo(ROLL_GAIN_LO);
    expect(fast.rollGain).toBeCloseTo(ROLL_GAIN_HI);
    expect(fast.rollRate).toBeGreaterThan(slow.rollRate);
    expect(mixLevels({ ...rolling, airborne: true }).rollGain).toBe(0);
  });

  it("fades the grind body in, then sits above a powerslide scrape", () => {
    const attack = mixLevels({ ...rolling, onGrind: true, grindTime: 0 });
    const grind = mixLevels({ ...rolling, onGrind: true, grindTime: 1 });
    expect(attack.grindGain).toBe(0);
    const slide = mixLevels({ ...rolling, duck: 0.2 });
    expect(grind.rollGain).toBe(0);
    expect(grind.grindGain).toBeGreaterThan(slide.grindGain);
    expect(slide.rollGain).toBe(0);
    expect(slide.grindGain).toBeGreaterThan(0);
  });

  it("goes quiet when the run is not playing", () => {
    const paused = mixLevels({ ...rolling, status: "paused" });
    const over = mixLevels({ ...rolling, onGrind: true, status: "gameover" });
    expect(paused.rollGain).toBe(0);
    expect(paused.grindGain).toBe(0);
    expect(over.grindGain).toBe(0);
  });
});
