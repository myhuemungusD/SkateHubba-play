import { afterEach, describe, expect, it, vi } from "vitest";
import { isExtrasEnabled, parseFlag } from "../featureFlags";

describe("parseFlag", () => {
  it("accepts only the literal string 'true'", () => {
    expect(parseFlag("true")).toBe(true);
  });

  it.each([undefined, null, "", "false", "TRUE", "True", "1", "yes", true])("treats %j as off", (raw) => {
    // A typo or a boolean-ish value in the Vercel UI must never resurface a
    // frozen feature — same strict contract as VITE_APPCHECK_ENABLED.
    expect(parseFlag(raw)).toBe(false);
  });
});

describe("isExtrasEnabled (VITE_FEATURE_EXTRAS_ENABLED)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is OFF when the env var is unset — the production default", () => {
    expect(import.meta.env.VITE_FEATURE_EXTRAS_ENABLED).toBeUndefined();
    expect(isExtrasEnabled()).toBe(false);
  });

  it("is OFF when the env var is an empty string (how Vercel exposes unset vars)", () => {
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "");
    expect(isExtrasEnabled()).toBe(false);
  });

  it("is ON when the env var is 'true'", () => {
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
    expect(isExtrasEnabled()).toBe(true);
  });

  it("re-reads the env on every call so the flag can flip without a reload in tests", () => {
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
    expect(isExtrasEnabled()).toBe(true);
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "false");
    expect(isExtrasEnabled()).toBe(false);
  });
});
