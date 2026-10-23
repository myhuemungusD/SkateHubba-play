import { afterEach, describe, expect, it, vi } from "vitest";
import { FEATURE_TESTER_STORAGE_KEY } from "../../../lib/featureFlags";
import { tipSetForPath } from "../tipSets";

describe("tipSetForPath — Skate Runner gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.removeItem(FEATURE_TESTER_STORAGE_KEY);
  });

  it("shows no runner tip while the flag is off", () => {
    vi.stubEnv("VITE_FEATURE_RUNNER_ENABLED", "");
    expect(tipSetForPath("/play/runner")).toBeNull();
  });

  it("shows the runner tip when the flag is on", () => {
    vi.stubEnv("VITE_FEATURE_RUNNER_ENABLED", "true");
    expect(tipSetForPath("/play/runner")?.id).toBe("runner");
  });

  it("shows the runner tip to testers via the override", () => {
    vi.stubEnv("VITE_FEATURE_RUNNER_ENABLED", "");
    localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "tester-uid");
    expect(tipSetForPath("/play/runner")?.id).toBe("runner");
  });

  it("leaves other screens alone", () => {
    vi.stubEnv("VITE_FEATURE_RUNNER_ENABLED", "");
    expect(tipSetForPath("/lobby")?.id).toBe("lobby");
    expect(tipSetForPath("/nope")).toBeNull();
  });
});

describe("map check-in tip — XP gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const checkInBody = () => tipSetForPath("/map")?.tips.find((t) => t.title === "check in")?.body;

  it("promises xp only when the build shows XP", () => {
    vi.stubEnv("VITE_FEATURE_XP_ENABLED", "true");
    expect(checkInBody()).toBe("pull up to a spot and check in for xp and a passport stamp.");
  });

  it("drops the xp promise when XP is hidden", () => {
    vi.stubEnv("VITE_FEATURE_XP_ENABLED", "false");
    expect(checkInBody()).toBe("pull up to a spot and check in for a passport stamp.");
  });
});
