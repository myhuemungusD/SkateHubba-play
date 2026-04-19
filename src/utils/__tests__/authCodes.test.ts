import { describe, it, expect } from "vitest";
import { isBenignAuthCode } from "../authCodes";

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

  it("treats infra/config codes as non-benign so they reach Sentry", () => {
    // auth/internal-error is the exact signal we need to alert on — must not
    // be filtered as benign or outage detection breaks.
    expect(isBenignAuthCode("auth/internal-error")).toBe(false);
    expect(isBenignAuthCode("auth/network-request-failed")).toBe(false);
    expect(isBenignAuthCode("auth/too-many-requests")).toBe(false);
    expect(isBenignAuthCode("auth/user-disabled")).toBe(false);
    expect(isBenignAuthCode("auth/operation-not-allowed")).toBe(false);
    expect(isBenignAuthCode("auth/unauthorized-domain")).toBe(false);
  });

  it("treats unknown / empty codes as non-benign (escalate for investigation)", () => {
    expect(isBenignAuthCode("")).toBe(false);
    expect(isBenignAuthCode("auth/some-brand-new-code")).toBe(false);
  });
});
