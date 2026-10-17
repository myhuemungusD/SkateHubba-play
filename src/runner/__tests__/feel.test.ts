import { describe, expect, it } from "vitest";
import { createRunnerController } from "../controller";
import {
  FALL_GRAVITY_SCALE,
  FEEL_PRESETS,
  GRIND_ASSIST_DEFAULT,
  feelPresetById,
  magnetLeadFor,
  magnetRadiusFor,
} from "../tune";

describe("frozen feel presets", () => {
  it("keeps street heavier than the old 1.6 and offers the other feels as presets", () => {
    expect(FALL_GRAVITY_SCALE).toBeGreaterThan(1.6);
    expect(FALL_GRAVITY_SCALE).toBeLessThanOrEqual(2);
    expect(feelPresetById("street").fallGravity).toBe(FALL_GRAVITY_SCALE);
    expect(feelPresetById("street").grindAssist).toBe(GRIND_ASSIST_DEFAULT);
    expect(GRIND_ASSIST_DEFAULT).toBeLessThanOrEqual(30);
    expect(feelPresetById("heavy").fallGravity).toBe(2);
    expect(feelPresetById("classic").fallGravity).toBe(1.6);
    expect(feelPresetById("classic").grindAssist).toBeGreaterThan(GRIND_ASSIST_DEFAULT);
    expect(FEEL_PRESETS).toHaveLength(3);
  });

  it("scales the magnet with assist and leaves zero assist with no pull", () => {
    expect(magnetLeadFor(0)).toBe(0);
    expect(magnetRadiusFor(0)).toBe(0);
    expect(magnetRadiusFor(30)).toBeLessThan(magnetRadiusFor(100));
    expect(magnetRadiusFor(100)).toBeCloseTo(0.35);
  });

  it("applies a preset to the live run and keeps it across a restart", () => {
    const run = createRunnerController({ spawn: false });
    expect(run.getState().fallScale).toBe(FALL_GRAVITY_SCALE);
    expect(run.grindAssist()).toBe(GRIND_ASSIST_DEFAULT);
    run.setFeelPreset("heavy");
    expect(run.feelPreset()).toBe("heavy");
    expect(run.getState().fallScale).toBe(2);
    expect(run.grindAssist()).toBe(15);
    run.setGrindAssist(8);
    expect(run.getState().grindAssist).toBe(8);
    run.restart();
    expect(run.getState().fallScale).toBe(2);
    expect(run.getState().grindAssist).toBe(8);
  });
});
