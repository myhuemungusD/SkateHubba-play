import { beforeEach, describe, expect, it, vi } from "vitest";

const { playHaptic, isNative, enabled } = vi.hoisted(() => ({
  playHaptic: vi.fn(),
  isNative: vi.fn(() => false),
  enabled: { value: true },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => isNative() },
}));

vi.mock("../../services/haptics", () => ({
  playHaptic: (...args: unknown[]) => playHaptic(...args),
  isHapticsEnabled: () => enabled.value,
}));

import { playRunnerHaptic, pulseGrindHaptic } from "../haptics";

describe("runner haptics", () => {
  beforeEach(() => {
    playHaptic.mockClear();
    isNative.mockReset();
    isNative.mockReturnValue(false);
    enabled.value = true;
  });

  it("does not use the native haptic in the browser", () => {
    playRunnerHaptic("powerslide", null, 0);
    playRunnerHaptic("pop", null, 60);
    playRunnerHaptic("land", null, 120);
    playRunnerHaptic("bail", null, 180);
    expect(playHaptic).not.toHaveBeenCalled();
  });

  it("vibrates in the browser when the device can, and skips a buzz inside 50 ms", () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    playRunnerHaptic("pop", null, 1000);
    playRunnerHaptic("lock", null, 1020);
    playRunnerHaptic("lock", null, 1060);
    playRunnerHaptic("land", "perfect", 1120);
    playRunnerHaptic("powerslide", null, 1180);
    playRunnerHaptic("bail", null, 1240);
    expect(vibrate).toHaveBeenCalledTimes(5);
    expect(playHaptic).not.toHaveBeenCalled();
  });

  it("maps native hits to light, medium, success, and a heavy crash", () => {
    isNative.mockReturnValue(true);
    playRunnerHaptic("powerslide", null, 2000);
    playRunnerHaptic("lock", null, 2060);
    playRunnerHaptic("land", "perfect", 2120);
    playRunnerHaptic("land", "clean", 2180);
    playRunnerHaptic("bail", null, 2240);
    expect(playHaptic.mock.calls).toEqual([
      ["toast"],
      ["button_primary"],
      ["trick_landed"],
      ["toast"],
      ["new_challenge"],
      ["game_lost"],
    ]);
  });

  it("stays quiet when haptics are off", () => {
    enabled.value = false;
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    playRunnerHaptic("pop", null, 3000);
    expect(vibrate).not.toHaveBeenCalled();
    expect(playHaptic).not.toHaveBeenCalled();
  });

  it("buzzes a clean landing and a native pop, and ignores an unknown event", () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    playRunnerHaptic("land", "clean", 4000);
    expect(vibrate).toHaveBeenLastCalledWith(18);
    playRunnerHaptic("wobble" as never, null, 4100);
    expect(vibrate).toHaveBeenCalledTimes(1);
    isNative.mockReturnValue(true);
    playRunnerHaptic("pop", null, 4200);
    playRunnerHaptic("wobble" as never, null, 4300);
    expect(playHaptic.mock.calls).toEqual([["toast"]]);
  });

  it("pulses a held grind natively, in the browser, or not at all", () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    pulseGrindHaptic(5000);
    pulseGrindHaptic(5010);
    expect(vibrate).toHaveBeenCalledExactlyOnceWith(8);
    isNative.mockReturnValue(true);
    pulseGrindHaptic(5100);
    expect(playHaptic).toHaveBeenCalledWith("toast");
    enabled.value = false;
    pulseGrindHaptic(5200);
    expect(playHaptic).toHaveBeenCalledTimes(1);
  });

  it("does nothing in a browser without vibration", () => {
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: undefined });
    expect(() => playRunnerHaptic("pop", null, 6000)).not.toThrow();
    expect(() => pulseGrindHaptic(6100)).not.toThrow();
    // No vibration API and not native: nothing falls through to the native haptic either.
    expect(playHaptic).not.toHaveBeenCalled();
    // Once vibration exists again the same grind pulse buzzes, so the silence above came from the guard.
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    pulseGrindHaptic(6200);
    expect(vibrate).toHaveBeenCalledExactlyOnceWith(8);
  });
});
