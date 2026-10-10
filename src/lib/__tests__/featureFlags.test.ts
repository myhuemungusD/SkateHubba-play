import { afterEach, describe, expect, it, vi } from "vitest";
import { isAppleSignInEnabled, isDiceEnabled, isExtrasEnabled, isRefereeEnabled, parseFlag } from "../featureFlags";

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

describe("isDiceEnabled (VITE_FEATURE_DICE_ENABLED)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is OFF when the env var is unset — the production default", () => {
    expect(import.meta.env.VITE_FEATURE_DICE_ENABLED).toBeUndefined();
    expect(isDiceEnabled()).toBe(false);
  });

  it("stays off for anything other than the literal string true", () => {
    vi.stubEnv("VITE_FEATURE_DICE_ENABLED", "TRUE");
    expect(isDiceEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_DICE_ENABLED", "true");
    expect(isDiceEnabled()).toBe(true);
  });

  it("does not follow the extras flag", () => {
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
    expect(isDiceEnabled()).toBe(false);
  });
});

describe("isAppleSignInEnabled (VITE_FEATURE_APPLE_SIGNIN_ENABLED)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is OFF when the env var is unset — the production default", () => {
    expect(import.meta.env.VITE_FEATURE_APPLE_SIGNIN_ENABLED).toBeUndefined();
    expect(isAppleSignInEnabled()).toBe(false);
  });

  it("stays off for anything other than the literal string true", () => {
    vi.stubEnv("VITE_FEATURE_APPLE_SIGNIN_ENABLED", "TRUE");
    expect(isAppleSignInEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_APPLE_SIGNIN_ENABLED", "");
    expect(isAppleSignInEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_APPLE_SIGNIN_ENABLED", "true");
    expect(isAppleSignInEnabled()).toBe(true);
  });

  it("does not follow the extras or dice flags", () => {
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
    vi.stubEnv("VITE_FEATURE_DICE_ENABLED", "true");
    expect(isAppleSignInEnabled()).toBe(false);
  });
});

describe("isRefereeEnabled (VITE_FEATURE_REFEREE_ENABLED)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is OFF when the env var is unset — the production default", () => {
    expect(import.meta.env.VITE_FEATURE_REFEREE_ENABLED).toBeUndefined();
    expect(isRefereeEnabled()).toBe(false);
  });

  it("stays off for anything other than the literal string true", () => {
    vi.stubEnv("VITE_FEATURE_REFEREE_ENABLED", "TRUE");
    expect(isRefereeEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_REFEREE_ENABLED", "");
    expect(isRefereeEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_REFEREE_ENABLED", "false");
    expect(isRefereeEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_REFEREE_ENABLED", "true");
    expect(isRefereeEnabled()).toBe(true);
  });

  it("does not follow the extras, dice, or apple flags", () => {
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
    vi.stubEnv("VITE_FEATURE_DICE_ENABLED", "true");
    vi.stubEnv("VITE_FEATURE_APPLE_SIGNIN_ENABLED", "true");
    expect(isRefereeEnabled()).toBe(false);
  });
});
