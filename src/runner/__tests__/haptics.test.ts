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

import { playRunnerHaptic } from "../haptics";

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
});
