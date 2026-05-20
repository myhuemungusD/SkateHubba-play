import { describe, it, expect } from "vitest";
import { isBenignAuthCode, getAuthErrorMessage } from "../authCodes";

describe("isBenignAuthCode", () => {
  it("treats common user-error codes as benign", () => {
    expect(isBenignAuthCode("auth/wrong-password")).toBe(true);
    expect(isBenignAuthCode("auth/user-not-found")).toBe(true);
    expect(isBenignAuthCode("auth/invalid-credential")).toBe(true);
    expect(isBenignAuthCode("auth/email-already-in-use")).toBe(true);
    expect(isBenignAuthCode("auth/weak-password")).toBe(true);
    expect(isBenignAuthCode("auth/popup-closed-by-user")).toBe(true);
    expect(isBenignAuthCode("auth/popup-blocked")).toBe(true);
  });

  it("treats user-environment failures as benign (Safari private, stale tab)", () => {
    // These are caused by the user's browser / session state — ops can't
    // fix them, so they must not page on-call.
    expect(isBenignAuthCode("auth/web-storage-unsupported")).toBe(true);
    expect(isBenignAuthCode("auth/missing-or-invalid-nonce")).toBe(true);
    expect(isBenignAuthCode("auth/timeout")).toBe(true);
  });

  it("treats infra/config codes as non-benign so they reach Sentry", () => {
    // auth/internal-error is the exact signal we need to alert on — must not
    // be filtered as benign or outage detection breaks.
    expect(isBenignAuthCode("auth/internal-error")).toBe(false);
    expect(isBenignAuthCode("auth/network-request-failed")).toBe(false);
    expect(isBenignAuthCode("auth/too-many-requests")).toBe(false);
    expect(isBenignAuthCode("auth/quota-exceeded")).toBe(false);
    expect(isBenignAuthCode("auth/user-disabled")).toBe(false);
    expect(isBenignAuthCode("auth/operation-not-allowed")).toBe(false);
    expect(isBenignAuthCode("auth/unauthorized-domain")).toBe(false);
  });

  it("treats unknown / empty codes as non-benign (escalate for investigation)", () => {
    expect(isBenignAuthCode("")).toBe(false);
    expect(isBenignAuthCode("auth/some-brand-new-code")).toBe(false);
  });
});

describe("getAuthErrorMessage", () => {
  it("maps credential failures to a single non-enumerating message", () => {
    expect(getAuthErrorMessage("auth/invalid-credential")).toBe("Invalid email or password");
    expect(getAuthErrorMessage("auth/wrong-password")).toBe("Invalid email or password");
  });

  it("maps user-environment failures to actionable copy", () => {
    expect(getAuthErrorMessage("auth/web-storage-unsupported")).toMatch(/private browsing|different browser/i);
    expect(getAuthErrorMessage("auth/missing-or-invalid-nonce")).toMatch(/reload the page/i);
    expect(getAuthErrorMessage("auth/timeout")).toMatch(/network/i);
  });

  it("maps rate-limit codes to the same wait message", () => {
    const tooMany = getAuthErrorMessage("auth/too-many-requests");
    expect(tooMany).toMatch(/wait/i);
    expect(getAuthErrorMessage("auth/quota-exceeded")).toBe(tooMany);
  });

  it("maps auth/internal-error to a retry message that hides the raw code", () => {
    const msg = getAuthErrorMessage("auth/internal-error");
    expect(msg).toMatch(/temporarily unavailable/i);
    expect(msg).not.toMatch(/auth\/internal-error/);
  });

  it("returns null for codes the caller must handle itself (context-sensitive)", () => {
    // email-already-in-use pairs with an inline mode-switch action that only
    // makes sense on AuthScreen; user-not-found pairs with the inverse. The
    // generic mapper deliberately yields so each caller wires its own copy.
    expect(getAuthErrorMessage("auth/email-already-in-use")).toBeNull();
    expect(getAuthErrorMessage("auth/user-not-found")).toBeNull();
  });

  it("returns null for unknown codes so callers fall back to generic", () => {
    expect(getAuthErrorMessage("auth/some-brand-new-code")).toBeNull();
    expect(getAuthErrorMessage("")).toBeNull();
  });
});
