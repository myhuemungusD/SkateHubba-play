import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MultiFactorInfo } from "firebase/auth";

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  verify: vi.fn(),
  clear: vi.fn(),
  credential: vi.fn((id?: string, code?: string) => ({ id, code })),
  assertion: vi.fn((c?: unknown) => ({ c })),
  requireAuth: vi.fn(),
  multiFactorThrows: { on: false },
  factors: { current: [] as MultiFactorInfo[] },
}));

vi.mock("firebase/auth", () => {
  class MockPhoneAuthProvider {
    static credential = h.credential;
    verifyPhoneNumber = h.verify;
  }
  class MockRecaptchaVerifier {
    clear = h.clear;
  }
  return {
    multiFactor: () => {
      if (h.multiFactorThrows.on) throw new Error("mf down");
      return { getSession: h.getSession, enroll: h.enroll, unenroll: h.unenroll, enrolledFactors: h.factors.current };
    },
    PhoneMultiFactorGenerator: { FACTOR_ID: "phone", assertion: h.assertion },
    PhoneAuthProvider: MockPhoneAuthProvider,
    RecaptchaVerifier: MockRecaptchaVerifier,
    TotpMultiFactorGenerator: { FACTOR_ID: "totp" },
    EmailAuthProvider: {},
    GoogleAuthProvider: class {},
    OAuthProvider: class {},
    reauthenticateWithCredential: vi.fn(),
    reauthenticateWithPopup: vi.fn(),
  };
});
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("@capacitor-firebase/authentication", () => ({ FirebaseAuthentication: {} }));
vi.mock("../../firebase", () => ({ requireAuth: () => h.requireAuth() }));

import {
  MfaFlowError,
  beginSmsEnrollment,
  confirmSmsEnrollment,
  getPhoneNumber,
  listSmsFactors,
  unenrollSmsFactor,
} from "../mfa.enroll";

const user = { uid: "u1" };
const fbErr = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  vi.clearAllMocks();
  h.multiFactorThrows.on = false;
  h.factors.current = [];
  h.requireAuth.mockReturnValue({ currentUser: user });
});

describe("listSmsFactors", () => {
  it("returns only phone factors", () => {
    h.factors.current = [{ factorId: "phone" }, { factorId: "totp" }] as MultiFactorInfo[];
    expect(listSmsFactors()).toEqual([{ factorId: "phone" }]);
  });
  it("returns [] when signed out", () => {
    h.requireAuth.mockReturnValue({ currentUser: null });
    expect(listSmsFactors()).toEqual([]);
  });
  it("returns [] when lookup throws", () => {
    h.multiFactorThrows.on = true;
    expect(listSmsFactors()).toEqual([]);
  });
});

describe("beginSmsEnrollment", () => {
  it("rejects empty input", async () => {
    await expect(beginSmsEnrollment("", "c")).rejects.toMatchObject({ code: "mfa/invalid-phone" });
  });
  it("rejects a too-short number", async () => {
    await expect(beginSmsEnrollment("+12", "c")).rejects.toMatchObject({ code: "mfa/invalid-phone" });
  });
  it("normalizes a US number, sends the code and clears the verifier", async () => {
    h.verify.mockResolvedValue("vid");
    await expect(beginSmsEnrollment(" (555) 123-4567 ", "c")).resolves.toBe("vid");
    expect(h.verify).toHaveBeenCalledWith("+15551234567", expect.anything());
    expect(h.clear).toHaveBeenCalled();
  });
  it("keeps an E.164 number and maps errors", async () => {
    h.verify.mockRejectedValue(fbErr("auth/requires-recent-login"));
    await expect(beginSmsEnrollment("+447700900123", "c")).rejects.toBeInstanceOf(MfaFlowError);
    expect(h.verify).toHaveBeenCalledWith("+447700900123", expect.anything());
    expect(h.clear).toHaveBeenCalled();
  });
});

describe("confirmSmsEnrollment", () => {
  it("rejects a bad code", async () => {
    await expect(confirmSmsEnrollment("vid", "12")).rejects.toMatchObject({ code: "mfa/invalid-code" });
  });
  it("enrolls with a default name", async () => {
    await confirmSmsEnrollment("vid", "123 456");
    expect(h.credential).toHaveBeenCalledWith("vid", "123456");
    expect(h.enroll).toHaveBeenCalledWith(expect.anything(), "Phone");
  });
  it("enrolls with a custom name and maps errors", async () => {
    await confirmSmsEnrollment("vid", "123456", "Mine");
    expect(h.enroll).toHaveBeenCalledWith(expect.anything(), "Mine");
    h.enroll.mockRejectedValueOnce(fbErr("auth/invalid-verification-code"));
    await expect(confirmSmsEnrollment("vid", "123456")).rejects.toMatchObject({
      code: "auth/invalid-verification-code",
    });
  });
});

describe("unenrollSmsFactor", () => {
  it("rejects an empty id", async () => {
    await expect(unenrollSmsFactor("")).rejects.toMatchObject({ code: "mfa/invalid-factor" });
  });
  it("unenrolls and maps errors", async () => {
    await unenrollSmsFactor("f1");
    expect(h.unenroll).toHaveBeenCalledWith("f1");
    h.unenroll.mockRejectedValueOnce(new Error("boom"));
    await expect(unenrollSmsFactor("f1")).rejects.toThrow("boom");
  });
});

describe("getPhoneNumber", () => {
  it("reads the number or falls back to empty", () => {
    expect(getPhoneNumber({ phoneNumber: "+1" } as unknown as MultiFactorInfo)).toBe("+1");
    expect(getPhoneNumber({} as MultiFactorInfo)).toBe("");
  });
});
