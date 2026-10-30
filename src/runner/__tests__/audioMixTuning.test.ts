import { describe, expect, it, vi } from "vitest";
import { mixLevels } from "../audioMix";
import { BASE_SPEED, GRIND_GAIN_LO, ROLL_RATE_LO } from "../tune";

// A degenerate tuning: no speed range and an instant grind attack.
vi.mock("../tune", async (importOriginal) => {
  const real = await importOriginal<typeof import("../tune")>();
  return { ...real, MAX_SPEED: real.BASE_SPEED, GRIND_ATTACK: 0 };
});

describe("layered audio with a flat tuning", () => {
  it("sits at the bottom of the roll range and opens a grind at once", () => {
    const levels = mixLevels({
      speed: BASE_SPEED + 3,
      onGrind: true,
      airborne: false,
      duck: -1,
      status: "playing",
      grindTime: 0,
      balance: 0,
    });
    expect(levels.rollRate).toBeCloseTo(ROLL_RATE_LO);
    expect(levels.grindGain).toBeCloseTo(GRIND_GAIN_LO);
  });
});
