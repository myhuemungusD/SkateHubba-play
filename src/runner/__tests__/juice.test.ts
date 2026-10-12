import { describe, expect, it } from "vitest";
import { emptyShake, shouldPuffDust, speedLineOpacity, stepPerfectShake } from "../juice";

describe("runner juice", () => {
  it("keeps speed lines off at the cruise speed and on as the run climbs", () => {
    expect(speedLineOpacity(6, false, true)).toBe(0);
    expect(speedLineOpacity(9, false, true)).toBeGreaterThan(0);
    expect(speedLineOpacity(9, true, true)).toBe(0);
    expect(speedLineOpacity(9, false, false)).toBe(0);
  });

  it("puffs dust only when a grind ends during play", () => {
    expect(shouldPuffDust(true, false, false, true)).toBe(true);
    expect(shouldPuffDust(false, false, false, true)).toBe(false);
    expect(shouldPuffDust(true, true, false, true)).toBe(false);
    expect(shouldPuffDust(true, false, true, true)).toBe(false);
    expect(shouldPuffDust(true, false, false, false)).toBe(false);
  });

  it("shakes only on the perfect lock, then returns to zero", () => {
    const clock = emptyShake();
    const still = stepPerfectShake(
      clock,
      { onGrind: true, wasOnGrind: false, grade: "good", reducedMotion: false },
      0.016,
    );
    expect(still).toEqual({ x: 0, y: 0 });

    const kick = stepPerfectShake(
      clock,
      { onGrind: true, wasOnGrind: false, grade: "perfect", reducedMotion: false },
      0.016,
    );
    expect(kick.x).not.toBe(0);

    const held = stepPerfectShake(
      clock,
      { onGrind: true, wasOnGrind: true, grade: "perfect", reducedMotion: false },
      0.016,
    );
    expect(Math.abs(held.x)).toBeLessThan(Math.abs(kick.x));

    const quiet = stepPerfectShake(
      clock,
      { onGrind: true, wasOnGrind: true, grade: "perfect", reducedMotion: true },
      0.016,
    );
    expect(quiet).toEqual({ x: 0, y: 0 });

    const skipped = emptyShake();
    expect(
      stepPerfectShake(skipped, { onGrind: true, wasOnGrind: false, grade: "perfect", reducedMotion: true }, 0.016),
    ).toEqual({ x: 0, y: 0 });

    const fade = emptyShake();
    stepPerfectShake(fade, { onGrind: true, wasOnGrind: false, grade: "perfect", reducedMotion: false }, 0.016);
    const done = stepPerfectShake(fade, { onGrind: true, wasOnGrind: true, grade: "perfect", reducedMotion: false }, 1);
    expect(done).toEqual({ x: 0, y: 0 });
  });
});
