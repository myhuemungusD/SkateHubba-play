import { afterEach, beforeEach, vi } from "vitest";

/** Env var behind the feature-freeze switch — see src/lib/featureFlags.ts. */
export const EXTRAS_FLAG = "VITE_FEATURE_EXTRAS_ENABLED";

/**
 * Registers hooks in the calling `describe` scope that run every test with
 * the Map / Clips feed / Verified Pro extras switched ON (`"true"`). Without
 * this the suite sees the production default: the var unset → extras OFF.
 * Env stubs are always reverted after each test so nothing leaks across files.
 */
export function withExtrasEnabled(): void {
  beforeEach(() => {
    vi.stubEnv(EXTRAS_FLAG, "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
}
