import { beforeEach, describe, expect, it, vi } from "vitest";

const { playHaptic, isNative } = vi.hoisted(() => ({
  playHaptic: vi.fn(),
  isNative: vi.fn(() => false),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => isNative() },
}));

vi.mock("../../services/haptics", () => ({
  playHaptic: (...args: unknown[]) => playHaptic(...args),
}));

import { playRunnerHaptic } from "../haptics";

describe("runner haptics", () => {
  beforeEach(() => {
    playHaptic.mockClear();
    isNative.mockReset();
    isNative.mockReturnValue(false);
  });

  it("does not use the native haptic in the browser", () => {
    playRunnerHaptic("powerslide");
    playRunnerHaptic("pop");
    playRunnerHaptic("land");
    playRunnerHaptic("bail");
    expect(playHaptic).not.toHaveBeenCalled();
  });

  it("vibrates in the browser when the device can", () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    playRunnerHaptic("pop");
    playRunnerHaptic("lock");
    playRunnerHaptic("land");
    playRunnerHaptic("powerslide");
    playRunnerHaptic("bail");
    expect(vibrate).toHaveBeenCalledTimes(4);
    expect(playHaptic).not.toHaveBeenCalled();
  });

  it("uses a light tap for a powerslide, a lock, and the landing on a native shell", () => {
    isNative.mockReturnValue(true);
    playRunnerHaptic("powerslide");
    playRunnerHaptic("lock");
    playRunnerHaptic("land");
    playRunnerHaptic("bail");
    expect(playHaptic.mock.calls).toEqual([["toast"], ["toast"], ["toast"]]);
  });
});
