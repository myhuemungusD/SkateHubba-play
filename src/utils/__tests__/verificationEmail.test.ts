import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  VERIFICATION_SEND_STATE_KEY,
  isVerificationRateLimit,
  readVerificationSendState,
  verificationContinueHost,
  verificationFailureMessage,
  writeVerificationSendState,
} from "../verificationEmail";

beforeEach(() => {
  sessionStorage.clear();
  vi.unstubAllEnvs();
});

describe("verificationFailureMessage", () => {
  it("names the throttle codes", () => {
    expect(verificationFailureMessage("auth/too-many-requests")).toMatch(/Wait five minutes/);
    expect(verificationFailureMessage("auth/quota-exceeded")).toMatch(/Wait five minutes/);
  });

  it("names a rejected continue URL", () => {
    expect(verificationFailureMessage("auth/unauthorized-continue-uri")).toMatch(/Authorized domains/);
    expect(verificationFailureMessage("auth/invalid-continue-uri")).toMatch(/Authorized domains/);
  });

  it("names a network failure", () => {
    expect(verificationFailureMessage("auth/network-request-failed")).toMatch(/never reached Firebase/);
  });

  it("names an App Check rejection", () => {
    expect(verificationFailureMessage("auth/firebase-app-check-token-is-invalid")).toMatch(/App Check/);
    expect(verificationFailureMessage("auth/invalid-app-credential")).toMatch(/App Check/);
  });

  it("names a missing user", () => {
    expect(verificationFailureMessage("auth/no-current-user")).toMatch(/not signed in/);
  });

  it("keeps an unknown code visible", () => {
    expect(verificationFailureMessage("auth/internal-error")).toContain("auth/internal-error");
  });

  it("says when no code came back", () => {
    expect(verificationFailureMessage("")).toMatch(/No error code/);
  });
});

describe("isVerificationRateLimit", () => {
  it("matches only the two throttle codes", () => {
    expect(isVerificationRateLimit("auth/too-many-requests")).toBe(true);
    expect(isVerificationRateLimit("auth/quota-exceeded")).toBe(true);
    expect(isVerificationRateLimit("auth/network-request-failed")).toBe(false);
  });
});

describe("verificationContinueHost", () => {
  it("uses VITE_APP_URL when set", () => {
    vi.stubEnv("VITE_APP_URL", "https://skatehubba.com");
    expect(verificationContinueHost()).toBe("skatehubba.com");
  });

  it("returns empty for a non-URL", () => {
    vi.stubEnv("VITE_APP_URL", "not a url");
    expect(verificationContinueHost()).toBe("");
  });
});

describe("verification send state", () => {
  it("round-trips an accepted send", () => {
    writeVerificationSendState({ status: "accepted" });
    expect(readVerificationSendState()).toEqual({ status: "accepted" });
  });

  it("round-trips a failed send", () => {
    writeVerificationSendState({ status: "failed", code: "auth/quota-exceeded" });
    expect(readVerificationSendState()).toEqual({ status: "failed", code: "auth/quota-exceeded" });
  });

  it("returns null for junk", () => {
    sessionStorage.setItem(VERIFICATION_SEND_STATE_KEY, "{");
    expect(readVerificationSendState()).toBeNull();
    sessionStorage.setItem(VERIFICATION_SEND_STATE_KEY, JSON.stringify({ status: "other" }));
    expect(readVerificationSendState()).toBeNull();
    sessionStorage.setItem(VERIFICATION_SEND_STATE_KEY, JSON.stringify({ status: "failed" }));
    expect(readVerificationSendState()).toEqual({ status: "failed", code: "" });
    sessionStorage.setItem(VERIFICATION_SEND_STATE_KEY, "null");
    expect(readVerificationSendState()).toBeNull();
  });
});
