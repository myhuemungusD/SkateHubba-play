import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MultiFactorInfo, MultiFactorResolver, User } from "firebase/auth";

/**
 * Second-factor sign-in resolution.
 *
 * `firebase/auth` is mocked wholesale (same pattern as auth-google.test.ts) so
 * the generators/verifier can be observed without a live Identity Platform
 * project. The assertions focus on the two things that actually broke in
 * production: recognising `auth/multi-factor-auth-required`, and never leaving
 * a rendered reCAPTCHA behind when a send attempt fails.
 */

const {
  mockGetMultiFactorResolver,
  mockVerifyPhoneNumber,
  mockPhoneCredential,
  mockPhoneAssertion,
  mockTotpAssertionForSignIn,
  mockRecaptchaCtor,
  mockRecaptchaClear,
} = vi.hoisted(() => ({
  mockGetMultiFactorResolver: vi.fn(),
  mockVerifyPhoneNumber: vi.fn(),
  mockPhoneCredential: vi.fn((verificationId?: string, code?: string) => ({ verificationId, code })),
  mockPhoneAssertion: vi.fn((credential?: unknown) => ({ kind: "phone-assertion", credential })),
  mockTotpAssertionForSignIn: vi.fn((enrollmentId?: string, code?: string) => ({
    kind: "totp-assertion",
    enrollmentId,
    code,
  })),
  mockRecaptchaCtor: vi.fn(),
  mockRecaptchaClear: vi.fn(),
}));

vi.mock("firebase/auth", () => {
  class MockPhoneAuthProvider {
    verifyPhoneNumber = (...args: unknown[]) => mockVerifyPhoneNumber(...args);
    static credential = mockPhoneCredential;
  }
  class MockRecaptchaVerifier {
    clear = mockRecaptchaClear;
    constructor(...args: unknown[]) {
      mockRecaptchaCtor(...args);
    }
  }
  return {
    getMultiFactorResolver: (...args: unknown[]) => mockGetMultiFactorResolver(...args),
    PhoneAuthProvider: MockPhoneAuthProvider,
    RecaptchaVerifier: MockRecaptchaVerifier,
    PhoneMultiFactorGenerator: { assertion: mockPhoneAssertion, FACTOR_ID: "phone" },
    TotpMultiFactorGenerator: { assertionForSignIn: mockTotpAssertionForSignIn, FACTOR_ID: "totp" },
  };
});

vi.mock("../../firebase");

import {
  getMfaChallenge,
  startSmsMfaSignIn,
  completeSmsMfaSignIn,
  completeTotpMfaSignIn,
  isPhoneHint,
  isTotpHint,
  hintPhoneNumber,
  type MfaChallenge,
} from "../mfa";

/* ── fixtures ─────────────────────────────────── */

const PHONE_HINT: MultiFactorInfo = {
  uid: "hint-phone",
  displayName: "My phone",
  enrollmentTime: "Mon, 01 Jan 2026 00:00:00 GMT",
  factorId: "phone",
};

const TOTP_HINT: MultiFactorInfo = {
  uid: "hint-totp",
  displayName: "Authenticator",
  enrollmentTime: "Mon, 01 Jan 2026 00:00:00 GMT",
  factorId: "totp",
};

const MFA_ERROR = { code: "auth/multi-factor-auth-required", message: "second factor required" };

/** Build a challenge whose resolver resolves/rejects as the test dictates. */
function makeChallenge(resolveSignIn: ReturnType<typeof vi.fn>): MfaChallenge {
  const resolver = { hints: [PHONE_HINT, TOTP_HINT], session: { id: "session-1" }, resolveSignIn };
  return { resolver: resolver as unknown as MultiFactorResolver, hints: resolver.hints };
}

const signedInUser = { uid: "u-mfa", email: "sk8r@test.com" } as User;

beforeEach(() => {
  vi.clearAllMocks();
});

/* ── getMfaChallenge ──────────────────────────── */

describe("getMfaChallenge", () => {
  it("builds the challenge from an auth/multi-factor-auth-required error", () => {
    mockGetMultiFactorResolver.mockReturnValueOnce({ hints: [PHONE_HINT], session: { id: "s" } });

    const challenge = getMfaChallenge(MFA_ERROR);

    expect(challenge).not.toBeNull();
    expect(challenge?.hints).toEqual([PHONE_HINT]);
    expect(challenge?.resolver.session).toEqual({ id: "s" });
    // The raw error is handed straight to the SDK — it carries the pending session.
    expect(mockGetMultiFactorResolver).toHaveBeenCalledWith(expect.anything(), MFA_ERROR);
  });

  it("returns null for a different Firebase Auth error code", () => {
    expect(getMfaChallenge({ code: "auth/wrong-password" })).toBeNull();
    expect(mockGetMultiFactorResolver).not.toHaveBeenCalled();
  });

  it.each([
    ["null", null],
    ["a string", "auth/multi-factor-auth-required"],
    ["an Error without a code", new Error("boom")],
    ["an object with a non-string code", { code: 42 }],
  ])("returns null for %s", (_label, value) => {
    expect(getMfaChallenge(value)).toBeNull();
    expect(mockGetMultiFactorResolver).not.toHaveBeenCalled();
  });

  it("returns null instead of throwing when the resolver lookup fails", () => {
    mockGetMultiFactorResolver.mockImplementationOnce(() => {
      throw new Error("no resolver for this error");
    });

    expect(getMfaChallenge(MFA_ERROR)).toBeNull();
  });

  it("returns null when the SDK hands back no resolver", () => {
    mockGetMultiFactorResolver.mockReturnValueOnce(undefined);

    expect(getMfaChallenge(MFA_ERROR)).toBeNull();
  });

  it("returns null when the resolver carries no hints array", () => {
    mockGetMultiFactorResolver.mockReturnValueOnce({ session: { id: "s" } });

    expect(getMfaChallenge(MFA_ERROR)).toBeNull();
  });
});

/* ── startSmsMfaSignIn ────────────────────────── */

describe("startSmsMfaSignIn", () => {
  it("sends the code and returns the verificationId", async () => {
    const challenge = makeChallenge(vi.fn());
    mockVerifyPhoneNumber.mockResolvedValueOnce("verification-id-1");

    const verificationId = await startSmsMfaSignIn(challenge, PHONE_HINT, "recaptcha-host");

    expect(verificationId).toBe("verification-id-1");
    expect(mockVerifyPhoneNumber).toHaveBeenCalledWith(
      { multiFactorHint: PHONE_HINT, session: challenge.resolver.session },
      expect.anything(),
    );
  });

  it("mounts an invisible reCAPTCHA on the supplied container", async () => {
    const host = document.createElement("div");
    mockVerifyPhoneNumber.mockResolvedValueOnce("vid");

    await startSmsMfaSignIn(makeChallenge(vi.fn()), PHONE_HINT, host);

    expect(mockRecaptchaCtor).toHaveBeenCalledWith(expect.anything(), host, { size: "invisible" });
  });

  it("clears the verifier after a successful send so a resend can render a new one", async () => {
    mockVerifyPhoneNumber.mockResolvedValueOnce("vid");

    await startSmsMfaSignIn(makeChallenge(vi.fn()), PHONE_HINT, "host");

    expect(mockRecaptchaClear).toHaveBeenCalledTimes(1);
  });

  it("clears the verifier and rethrows when the send fails", async () => {
    const err = Object.assign(new Error("too many"), { code: "auth/too-many-requests" });
    mockVerifyPhoneNumber.mockRejectedValueOnce(err);

    await expect(startSmsMfaSignIn(makeChallenge(vi.fn()), PHONE_HINT, "host")).rejects.toBe(err);
    // A stale widget here would break the retry the user is about to make.
    expect(mockRecaptchaClear).toHaveBeenCalledTimes(1);
  });
});

/* ── completeSmsMfaSignIn ─────────────────────── */

describe("completeSmsMfaSignIn", () => {
  it("resolves sign-in with a phone assertion and returns the user", async () => {
    const resolveSignIn = vi.fn().mockResolvedValueOnce({ user: signedInUser });
    const challenge = makeChallenge(resolveSignIn);

    const user = await completeSmsMfaSignIn(challenge, "vid-9", "123456");

    expect(user).toBe(signedInUser);
    expect(mockPhoneCredential).toHaveBeenCalledWith("vid-9", "123456");
    expect(mockPhoneAssertion).toHaveBeenCalledWith({ verificationId: "vid-9", code: "123456" });
    expect(resolveSignIn).toHaveBeenCalledWith({
      kind: "phone-assertion",
      credential: { verificationId: "vid-9", code: "123456" },
    });
  });

  it("rethrows an invalid-code rejection so the UI can map it", async () => {
    const err = Object.assign(new Error("bad code"), { code: "auth/invalid-verification-code" });
    const challenge = makeChallenge(vi.fn().mockRejectedValueOnce(err));

    await expect(completeSmsMfaSignIn(challenge, "vid-9", "000000")).rejects.toBe(err);
  });
});

/* ── completeTotpMfaSignIn ────────────────────── */

describe("completeTotpMfaSignIn", () => {
  it("asserts against the hint's enrolment id and returns the user", async () => {
    const resolveSignIn = vi.fn().mockResolvedValueOnce({ user: signedInUser });
    const challenge = makeChallenge(resolveSignIn);

    const user = await completeTotpMfaSignIn(challenge, TOTP_HINT, "654321");

    expect(user).toBe(signedInUser);
    expect(mockTotpAssertionForSignIn).toHaveBeenCalledWith(TOTP_HINT.uid, "654321");
    expect(resolveSignIn).toHaveBeenCalledTimes(1);
  });

  it("rethrows when the one-time password is rejected", async () => {
    const err = { code: "auth/invalid-verification-code", message: "nope" };
    const challenge = makeChallenge(vi.fn().mockRejectedValueOnce(err));

    await expect(completeTotpMfaSignIn(challenge, TOTP_HINT, "111111")).rejects.toBe(err);
    expect(mockTotpAssertionForSignIn).toHaveBeenCalledTimes(1);
  });
});

/* ── hint discriminators ──────────────────────── */

describe("hint discriminators", () => {
  it("identifies a phone hint", () => {
    expect(isPhoneHint(PHONE_HINT)).toBe(true);
    expect(isPhoneHint(TOTP_HINT)).toBe(false);
  });

  it("identifies a TOTP hint", () => {
    expect(isTotpHint(TOTP_HINT)).toBe(true);
    expect(isTotpHint(PHONE_HINT)).toBe(false);
  });
});

/* ── hintPhoneNumber ──────────────────────────── */

describe("hintPhoneNumber", () => {
  it("returns the masked number Firebase puts on a phone hint", () => {
    // Firebase masks the number itself — the service passes it through untouched.
    const hint = { ...PHONE_HINT, phoneNumber: "+*******1234" } as MultiFactorInfo;

    expect(hintPhoneNumber(hint)).toBe("+*******1234");
  });

  it("returns an empty string for a hint without a phone number", () => {
    expect(hintPhoneNumber(TOTP_HINT)).toBe("");
  });

  it("returns an empty string when the property is not a string", () => {
    const hint = { ...PHONE_HINT, phoneNumber: 5551234 } as unknown as MultiFactorInfo;

    expect(hintPhoneNumber(hint)).toBe("");
  });
});
