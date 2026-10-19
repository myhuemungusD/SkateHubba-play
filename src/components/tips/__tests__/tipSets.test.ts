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
