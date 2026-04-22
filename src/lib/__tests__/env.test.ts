import { describe, it, expect } from "vitest";
import { safeParseEnv, type Env } from "../env";

/* ── Fixture ────────────────────────────────────────────────────────────
 * A full env object that satisfies every required schema field. Spread and
 * override to build per-test scenarios without repeating the happy-path keys.
 * ──────────────────────────────────────────────────────────────────── */
const validEnv = {
  VITE_FIREBASE_API_KEY: "AIzaSyTEST",
  VITE_FIREBASE_AUTH_DOMAIN: "sk8hub-d7806.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "sk8hub-d7806",
  VITE_FIREBASE_STORAGE_BUCKET: "sk8hub-d7806.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "1234567890",
  VITE_FIREBASE_APP_ID: "1:1234567890:web:abc123",
};

describe("safeParseEnv", () => {
  it("returns a typed env object when every required var is present (happy path)", () => {
    const result: Env | null = safeParseEnv(validEnv);
    expect(result).not.toBeNull();
    expect(result!.VITE_FIREBASE_API_KEY).toBe("AIzaSyTEST");
    expect(result!.VITE_FIREBASE_PROJECT_ID).toBe("sk8hub-d7806");
    // Optional fields default to undefined, not missing
    expect(result!.VITE_MAPBOX_TOKEN).toBeUndefined();
    expect(result!.VITE_SENTRY_DSN).toBeUndefined();
  });

  it("returns null when a required var is missing", () => {
    const { VITE_FIREBASE_API_KEY: _omitted, ...withoutApiKey } = validEnv;
    expect(safeParseEnv(withoutApiKey)).toBeNull();
  });

  it("returns null when a required var is an empty string (fails .min(1))", () => {
    expect(safeParseEnv({ ...validEnv, VITE_FIREBASE_API_KEY: "" })).toBeNull();
  });

  it("coerces VITE_USE_EMULATORS from the string 'true' to boolean true", () => {
    const result = safeParseEnv({ ...validEnv, VITE_USE_EMULATORS: "true" });
    expect(result?.VITE_USE_EMULATORS).toBe(true);
  });

  it("coerces VITE_USE_EMULATORS from the string 'false' to boolean false", () => {
    const result = safeParseEnv({ ...validEnv, VITE_USE_EMULATORS: "false" });
    expect(result?.VITE_USE_EMULATORS).toBe(false);
  });

  it("rejects VITE_USE_EMULATORS values that are not 'true' or 'false'", () => {
    expect(safeParseEnv({ ...validEnv, VITE_USE_EMULATORS: "yes" })).toBeNull();
  });

  it("accepts every optional var when provided with a valid string", () => {
    const result = safeParseEnv({
      ...validEnv,
      VITE_MAPBOX_TOKEN: "pk.eyJ1",
      VITE_SENTRY_DSN: "https://abc@sentry.io/1",
      VITE_POSTHOG_KEY: "phc_test",
      VITE_APP_URL: "https://skatehubba.com",
    });
    expect(result?.VITE_MAPBOX_TOKEN).toBe("pk.eyJ1");
    expect(result?.VITE_SENTRY_DSN).toBe("https://abc@sentry.io/1");
    expect(result?.VITE_POSTHOG_KEY).toBe("phc_test");
    expect(result?.VITE_APP_URL).toBe("https://skatehubba.com");
  });
});
