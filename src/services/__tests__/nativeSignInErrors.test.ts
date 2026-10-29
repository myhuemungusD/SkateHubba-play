import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/sentry", async (importOriginal) =>
  (await import("./nativeSignIn.test-helpers")).sentryWithCaptureMessageSpy(importOriginal),
);
import { captureMessageSpy, unavailableWarning } from "./nativeSignIn.test-helpers";

import {
  isAppleSheetCancel,
  isAppleSignInUnavailable,
  isGoogleSheetCancel,
  isGoogleSignInUnavailable,
  reportSignInUnavailable,
  signInDismissedError,
} from "../nativeSignInErrors";

/**
 * The plugin hands Apple and Google SDK errors to JS with no `code`, so these
 * classifiers are the only thing standing between a native failure and the
 * right UI: silent for a closed sheet, "use Email" for a sheet that can't run.
 */

const APPLE_1000 =
  "The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1000.)";
const APPLE_1001 =
  "The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isAppleSignInUnavailable", () => {
  it.each([
    ["the iOS plugin message", new Error(APPLE_1000)],
    ["a localized message", new Error("(com.apple.AuthenticationServices.AuthorizationError Fehler 1000.)")],
    ["a numeric code", { code: 1000 }],
    ["a string code", { code: "1000" }],
  ])("matches ASAuthorizationError 1000 as %s", (_label, err) => {
    expect(isAppleSignInUnavailable(err)).toBe(true);
    expect(isAppleSheetCancel(err)).toBe(false);
  });

  it.each([
    ["the cancel code", new Error(APPLE_1001)],
    [
      "a longer code that starts with 1000",
      new Error("(com.apple.AuthenticationServices.AuthorizationError error 10001.)"),
    ],
    ["a bare 1000 in other text", new Error("HTTP error 1000")],
    ["a non-error value", null],
    ["a non-string message", { message: 1000 }],
  ])("does not match %s", (_label, err) => {
    expect(isAppleSignInUnavailable(err)).toBe(false);
  });
});

describe("isAppleSheetCancel", () => {
  it("matches the cancel NSError and the Firebase dismiss codes, nothing looser", () => {
    expect(isAppleSheetCancel(new Error(APPLE_1001))).toBe(true);
    expect(isAppleSheetCancel({ code: "auth/popup-closed-by-user" })).toBe(true);
    expect(isAppleSheetCancel({ code: "auth/cancelled-popup-request" })).toBe(true);
    expect(isAppleSheetCancel({ code: 1001 })).toBe(true);
    expect(isAppleSheetCancel(new Error("User canceled the authorization"))).toBe(false);
    expect(isAppleSheetCancel(undefined)).toBe(false);
  });
});

describe("Google classifiers", () => {
  it("match only GIDSignIn's and AppAuth's exact strings", () => {
    expect(isGoogleSheetCancel(new Error("The user canceled the sign-in flow."))).toBe(true);
    expect(isGoogleSignInUnavailable(new Error("Unable to open Safari."))).toBe(true);

    expect(isGoogleSheetCancel(new Error("Unable to open Safari."))).toBe(false);
    expect(isGoogleSignInUnavailable(new Error("The user canceled the sign-in flow."))).toBe(false);
    expect(isGoogleSheetCancel(new Error("canceled"))).toBe(false);
    expect(isGoogleSignInUnavailable(new Error("Unable to open Safari. Try again"))).toBe(false);
    expect(isGoogleSheetCancel(null)).toBe(false);
    expect(isGoogleSignInUnavailable({})).toBe(false);
  });
});

describe("signInDismissedError", () => {
  it.each([
    ["apple" as const, "Apple sign-in was cancelled"],
    ["google" as const, "Google sign-in was cancelled"],
  ])("gives the %s dismiss the silent code and keeps the original as cause", (method, message) => {
    const original = new Error("x");
    const err = signInDismissedError(method, original);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(message);
    expect(err).toMatchObject({ code: "auth/popup-closed-by-user", cause: original });
  });
});

describe("reportSignInUnavailable", () => {
  it("sends one warning with only fixed fields, never the raw error text", () => {
    const original = new Error(`${APPLE_1000} user@example.com`);
    const err = reportSignInUnavailable("apple", original);

    expect(err).toMatchObject({ code: "sign-in/apple-unavailable", cause: original });
    expect(err.message).toBe("apple_sign_in_unavailable");
    expect(captureMessageSpy).toHaveBeenCalledTimes(1);
    expect(captureMessageSpy).toHaveBeenCalledWith(...unavailableWarning("apple"));
    const sent = JSON.stringify(captureMessageSpy.mock.calls);
    expect(sent).not.toContain("operation");
    expect(sent).not.toContain("example.com");
  });

  it("uses the Google reason and code for Google", () => {
    const err = reportSignInUnavailable("google", new Error("Unable to open Safari."));
    expect(err).toMatchObject({ code: "sign-in/google-unavailable" });
    expect(captureMessageSpy).toHaveBeenCalledWith(...unavailableWarning("google"));
    expect(JSON.stringify(captureMessageSpy.mock.calls)).not.toContain("Safari");
  });
});
