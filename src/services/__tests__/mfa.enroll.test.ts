import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MultiFactorInfo, TotpSecret, User } from "firebase/auth";

const {
  mockGetSession,
  mockEnroll,
  mockUnenroll,
  mockGenerateSecret,
  mockAssertionForEnrollment,
  mockReauthCredential,
  mockReauthPopup,
  mockEmailCredential,
  mockGoogleCredential,
  mockNative,
  mockNativeGoogle,
  mockNativeApple,
  mockRequireAuth,
  factorBox,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockEnroll: vi.fn(),
  mockUnenroll: vi.fn(),
  mockGenerateSecret: vi.fn(),
  mockAssertionForEnrollment: vi.fn((secret?: unknown, code?: string) => ({ secret, code })),
  mockReauthCredential: vi.fn(),
  mockReauthPopup: vi.fn(),
  mockEmailCredential: vi.fn((email?: string, password?: string) => ({ email, password })),
  mockGoogleCredential: vi.fn((idToken?: string, accessToken?: string) => ({ idToken, accessToken })),
  mockNative: vi.fn(() => false),
  mockNativeGoogle: vi.fn(),
  mockNativeApple: vi.fn(),
  mockRequireAuth: vi.fn(),
  factorBox: { current: [] as MultiFactorInfo[] },
}));

vi.mock("firebase/auth", () => {
  class MockGoogleAuthProvider {
    setCustomParameters = vi.fn();
    static credential = mockGoogleCredential;
  }
  class MockOAuthProvider {
    addScope = vi.fn();
    credential = vi.fn((payload?: unknown) => ({ payload }));
    constructor(readonly providerId: string) {}
  }
  return {
    multiFactor: () => ({
      getSession: mockGetSession,
      enroll: mockEnroll,
      unenroll: mockUnenroll,
      enrolledFactors: factorBox.current,
    }),
    TotpMultiFactorGenerator: {
      FACTOR_ID: "totp",
      generateSecret: mockGenerateSecret,
      assertionForEnrollment: mockAssertionForEnrollment,
    },
    EmailAuthProvider: { credential: mockEmailCredential },
    GoogleAuthProvider: MockGoogleAuthProvider,
    OAuthProvider: MockOAuthProvider,
    reauthenticateWithCredential: mockReauthCredential,
    reauthenticateWithPopup: mockReauthPopup,
  };
});

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mockNative() },
}));

vi.mock("@capacitor-firebase/authentication", () => ({
  FirebaseAuthentication: {
    signInWithGoogle: (...args: unknown[]) => mockNativeGoogle(...args),
    signInWithApple: (...args: unknown[]) => mockNativeApple(...args),
  },
}));

vi.mock("../../firebase", () => ({
  requireAuth: () => mockRequireAuth(),
}));

import {
  MFA_UNAVAILABLE,
  MfaFlowError,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  listTotpFactors,
  reauthMethod,
  reauthenticateForMfa,
  unenrollTotpFactor,
} from "../mfa.enroll";

const TOTP_FACTOR: MultiFactorInfo = {
  uid: "factor-1",
  displayName: "Authenticator app",
  enrollmentTime: "Mon, 01 Jan 2026 00:00:00 GMT",
  factorId: "totp",
};

const PHONE_FACTOR: MultiFactorInfo = {
  uid: "factor-phone",
  displayName: "Phone",
  enrollmentTime: "Mon, 01 Jan 2026 00:00:00 GMT",
  factorId: "phone",
};

function user(overrides: Partial<User> = {}): User {
  return {
    uid: "u1",
    email: "sk8r@test.com",
    providerData: [{ providerId: "password" }],
    ...overrides,
  } as User;
}

const secret = {
  secretKey: "SECRETKEY",
  generateQrCodeUrl: vi.fn(() => "otpauth://totp/SkateHubba"),
} as unknown as TotpSecret;

beforeEach(() => {
  vi.clearAllMocks();
  mockNative.mockReturnValue(false);
  mockRequireAuth.mockReturnValue({ currentUser: user() });
  factorBox.current = [TOTP_FACTOR];
  mockGetSession.mockResolvedValue({ id: "session" });
  mockGenerateSecret.mockResolvedValue(secret);
  mockEnroll.mockResolvedValue(undefined);
  mockUnenroll.mockResolvedValue(undefined);
  mockReauthCredential.mockResolvedValue(undefined);
  mockReauthPopup.mockResolvedValue(undefined);
});

describe("listTotpFactors", () => {
  it("returns only authenticator factors", () => {
    factorBox.current = [PHONE_FACTOR, TOTP_FACTOR];
    expect(listTotpFactors()).toEqual([TOTP_FACTOR]);
  });

  it("returns nothing when nobody is signed in", () => {
    mockRequireAuth.mockReturnValue({ currentUser: null });
    expect(listTotpFactors()).toEqual([]);
  });

  it("returns nothing when Auth is not ready", () => {
    mockRequireAuth.mockImplementation(() => {
      throw new Error("Firebase not initialized");
    });
    expect(listTotpFactors()).toEqual([]);
  });
});

describe("beginTotpEnrollment", () => {
  it("returns the secret, manual key, and otpauth url", async () => {
    const setup = await beginTotpEnrollment();
    expect(setup.secretKey).toBe("SECRETKEY");
    expect(setup.qrCodeUrl).toBe("otpauth://totp/SkateHubba");
    expect(secret.generateQrCodeUrl).toHaveBeenCalledWith("sk8r@test.com", "SkateHubba");
  });

  it("uses the uid when the account has no email", async () => {
    mockRequireAuth.mockReturnValue({ currentUser: user({ email: null }) });
    await beginTotpEnrollment();
    expect(secret.generateQrCodeUrl).toHaveBeenCalledWith("u1", "SkateHubba");
  });

  it("asks for a recent sign-in", async () => {
    mockGetSession.mockRejectedValueOnce(Object.assign(new Error("recent"), { code: "auth/requires-recent-login" }));
    await expect(beginTotpEnrollment()).rejects.toMatchObject({ code: "auth/requires-recent-login" });
  });

  it("reports that TOTP is not available yet when the project has it switched off", async () => {
    mockGenerateSecret.mockRejectedValueOnce(Object.assign(new Error("off"), { code: "auth/operation-not-allowed" }));
    await expect(beginTotpEnrollment()).rejects.toMatchObject({ code: MFA_UNAVAILABLE });
  });

  it("reports the same when Identity Platform is not enabled", async () => {
    mockGenerateSecret.mockRejectedValueOnce(
      Object.assign(new Error("no idp"), { code: "auth/operation-not-supported-in-this-environment" }),
    );
    await expect(beginTotpEnrollment()).rejects.toBeInstanceOf(MfaFlowError);
  });

  it("rethrows an unexpected failure", async () => {
    const err = Object.assign(new Error("nope"), { code: "auth/network-request-failed" });
    mockGenerateSecret.mockRejectedValueOnce(err);
    await expect(beginTotpEnrollment()).rejects.toBe(err);
  });

  it("refuses when signed out", async () => {
    mockRequireAuth.mockReturnValue({ currentUser: null });
    await expect(beginTotpEnrollment()).rejects.toMatchObject({ code: "mfa/signed-out" });
  });
});

describe("confirmTotpEnrollment", () => {
  it("enrolls with a 6-digit code and ignores spaces", async () => {
    await confirmTotpEnrollment(secret, "123 456");
    expect(mockAssertionForEnrollment).toHaveBeenCalledWith(secret, "123456");
    expect(mockEnroll).toHaveBeenCalledWith({ secret, code: "123456" }, "Authenticator app");
  });

  it("rejects a code that is not 6 digits", async () => {
    await expect(confirmTotpEnrollment(secret, "12345")).rejects.toMatchObject({ code: "mfa/invalid-code" });
    expect(mockEnroll).not.toHaveBeenCalled();
  });

  it("maps a wrong code", async () => {
    mockEnroll.mockRejectedValueOnce(Object.assign(new Error("bad"), { code: "auth/invalid-verification-code" }));
    await expect(confirmTotpEnrollment(secret, "123456")).rejects.toMatchObject({
      code: "auth/invalid-verification-code",
    });
  });

  it("maps a recent-login failure during confirm", async () => {
    mockEnroll.mockRejectedValueOnce(Object.assign(new Error("recent"), { code: "auth/requires-recent-login" }));
    await expect(confirmTotpEnrollment(secret, "123456")).rejects.toMatchObject({ code: "auth/requires-recent-login" });
  });

  it("rethrows other confirm failures", async () => {
    const err = Object.assign(new Error("quota"), { code: "auth/too-many-requests" });
    mockEnroll.mockRejectedValueOnce(err);
    await expect(confirmTotpEnrollment(secret, "123456")).rejects.toBe(err);
  });
});

describe("unenrollTotpFactor", () => {
  it("removes the factor", async () => {
    await unenrollTotpFactor("factor-1");
    expect(mockUnenroll).toHaveBeenCalledWith("factor-1");
  });

  it("rejects an empty factor id", async () => {
    await expect(unenrollTotpFactor("")).rejects.toMatchObject({ code: "mfa/invalid-factor" });
  });

  it("maps project-unavailable on unenroll", async () => {
    mockUnenroll.mockRejectedValueOnce(Object.assign(new Error("off"), { code: "auth/operation-not-allowed" }));
    await expect(unenrollTotpFactor("factor-1")).rejects.toMatchObject({ code: MFA_UNAVAILABLE });
  });
});

describe("reauthMethod", () => {
  it("prefers password when it is linked", () => {
    mockRequireAuth.mockReturnValue({
      currentUser: user({ providerData: [{ providerId: "google.com" }, { providerId: "password" }] as User["providerData"] }),
    });
    expect(reauthMethod()).toBe("password");
  });

  it("uses google when that is the only provider", () => {
    mockRequireAuth.mockReturnValue({
      currentUser: user({ providerData: [{ providerId: "google.com" }] as User["providerData"] }),
    });
    expect(reauthMethod()).toBe("google");
  });

  it("uses apple when that is the only provider", () => {
    mockRequireAuth.mockReturnValue({
      currentUser: user({ providerData: [{ providerId: "apple.com" }] as User["providerData"] }),
    });
    expect(reauthMethod()).toBe("apple");
  });

  it("is unsupported with no usable provider, no user, or Auth down", () => {
    mockRequireAuth.mockReturnValue({
      currentUser: user({ providerData: [{ providerId: "phone" }] as User["providerData"] }),
    });
    expect(reauthMethod()).toBe("unsupported");
    mockRequireAuth.mockReturnValue({ currentUser: null });
    expect(reauthMethod()).toBe("unsupported");
    mockRequireAuth.mockImplementation(() => {
      throw new Error("down");
    });
    expect(reauthMethod()).toBe("unsupported");
  });
});

describe("reauthenticateForMfa", () => {
  it("reauthenticates an email account with the password", async () => {
    await reauthenticateForMfa("hunter2");
    expect(mockEmailCredential).toHaveBeenCalledWith("sk8r@test.com", "hunter2");
    expect(mockReauthCredential).toHaveBeenCalledTimes(1);
  });

  it("requires a password for an email account", async () => {
    await expect(reauthenticateForMfa()).rejects.toMatchObject({ code: "mfa/password-required" });
    mockRequireAuth.mockReturnValue({ currentUser: user({ email: null }) });
    await expect(reauthenticateForMfa("hunter2")).rejects.toMatchObject({ code: "mfa/password-required" });
  });

  it("reauthenticates Google on the web with a popup", async () => {
    mockRequireAuth.mockReturnValue({
      currentUser: user({ providerData: [{ providerId: "google.com" }] as User["providerData"] }),
    });
    await reauthenticateForMfa();
    expect(mockReauthPopup).toHaveBeenCalledTimes(1);
  });

  it("reauthenticates Google on a native shell with the id token", async () => {
    mockNative.mockReturnValue(true);
    mockNativeGoogle.mockResolvedValue({ credential: { idToken: "gid", accessToken: "gat" } });
    mockRequireAuth.mockReturnValue({
      currentUser: user({ providerData: [{ providerId: "google.com" }] as User["providerData"] }),
    });
    await reauthenticateForMfa();
    expect(mockGoogleCredential).toHaveBeenCalledWith("gid", "gat");
    expect(mockReauthCredential).toHaveBeenCalledTimes(1);
  });

  it("fails when native Google returns no id token", async () => {
    mockNative.mockReturnValue(true);
    mockNativeGoogle.mockResolvedValue({ credential: {} });
    mockRequireAuth.mockReturnValue({
      currentUser: user({ providerData: [{ providerId: "google.com" }] as User["providerData"] }),
    });
    await expect(reauthenticateForMfa()).rejects.toThrow(/no idToken/);
  });

  it("reauthenticates Apple on the web with a popup", async () => {
    mockRequireAuth.mockReturnValue({
      currentUser: user({ providerData: [{ providerId: "apple.com" }] as User["providerData"] }),
    });
    await reauthenticateForMfa();
    expect(mockReauthPopup).toHaveBeenCalledTimes(1);
  });

  it("reauthenticates Apple on a native shell", async () => {
    mockNative.mockReturnValue(true);
    mockNativeApple.mockResolvedValue({ credential: { idToken: "aid", nonce: "nonce-1" } });
    mockRequireAuth.mockReturnValue({
      currentUser: user({ providerData: [{ providerId: "apple.com" }] as User["providerData"] }),
    });
    await reauthenticateForMfa();
    expect(mockReauthCredential).toHaveBeenCalledTimes(1);
  });

  it("fails when native Apple omits the nonce", async () => {
    mockNative.mockReturnValue(true);
    mockNativeApple.mockResolvedValue({ credential: { idToken: "aid" } });
    mockRequireAuth.mockReturnValue({
      currentUser: user({ providerData: [{ providerId: "apple.com" }] as User["providerData"] }),
    });
    await expect(reauthenticateForMfa()).rejects.toThrow(/no idToken/);
  });

  it("fails when native Apple omits the token", async () => {
    mockNative.mockReturnValue(true);
    mockNativeApple.mockResolvedValue({ credential: { nonce: "nonce-1" } });
    mockRequireAuth.mockReturnValue({
      currentUser: user({ providerData: [{ providerId: "apple.com" }] as User["providerData"] }),
    });
    await expect(reauthenticateForMfa()).rejects.toThrow(/no idToken/);
  });

  it("tells an unsupported provider to sign in again", async () => {
    mockRequireAuth.mockReturnValue({
      currentUser: user({ providerData: [] as User["providerData"] }),
    });
    await expect(reauthenticateForMfa()).rejects.toMatchObject({ code: "mfa/unsupported-provider" });
  });

  it("rethrows a popup failure", async () => {
    const err = Object.assign(new Error("blocked"), { code: "auth/popup-blocked" });
    mockReauthPopup.mockRejectedValueOnce(err);
    mockRequireAuth.mockReturnValue({
      currentUser: user({ providerData: [{ providerId: "google.com" }] as User["providerData"] }),
    });
    await expect(reauthenticateForMfa()).rejects.toBe(err);
  });
});
