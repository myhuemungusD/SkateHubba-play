import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MultiFactorInfo } from "firebase/auth";

const m = vi.hoisted(() => ({
  list: vi.fn(),
  begin: vi.fn(),
  confirm: vi.fn(),
  unenroll: vi.fn(),
  method: vi.fn(),
  reauth: vi.fn(),
  hasPw: vi.fn(),
  native: vi.fn(() => false),
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => m.native() } }));
vi.mock("../../services/mfa.enroll", () => ({
  MFA_UNAVAILABLE: "mfa/unavailable",
  listSmsFactors: () => m.list(),
  hasPasswordSignIn: () => m.hasPw(),
  beginSmsEnrollment: (...a: unknown[]) => m.begin(...a),
  confirmSmsEnrollment: (...a: unknown[]) => m.confirm(...a),
  unenrollSmsFactor: (...a: unknown[]) => m.unenroll(...a),
  reauthMethod: () => m.method(),
  reauthenticateForMfa: (...a: unknown[]) => m.reauth(...a),
  getPhoneNumber: (f: { phoneNumber?: string }) => f.phoneNumber ?? "",
}));

import { SmsTwoFactorSection } from "../SmsTwoFactorSection";

const factor = { uid: "f1", factorId: "phone", phoneNumber: "+15551234567" } as unknown as MultiFactorInfo;
const err = (code: string, msg = code) => Object.assign(new Error(msg), { code });

beforeEach(() => {
  vi.clearAllMocks();
  m.native.mockReturnValue(false);
  m.list.mockReturnValue([]);
  m.hasPw.mockReturnValue(true);
  m.method.mockReturnValue("password");
  m.begin.mockResolvedValue("vid");
  m.confirm.mockResolvedValue(undefined);
  m.unenroll.mockResolvedValue(undefined);
  m.reauth.mockResolvedValue(undefined);
});

async function startEnroll(phone = "5551234567") {
  const u = userEvent.setup();
  render(<SmsTwoFactorSection />);
  await u.click(screen.getByText("Set up text codes"));
  if (phone) await u.type(screen.getByPlaceholderText("+1234567890"), phone);
  await u.click(screen.getByText("Send code"));
  return u;
}

describe("SmsTwoFactorSection", () => {
  it("renders nothing for Google/Apple-only users", () => {
    m.hasPw.mockReturnValue(false);
    const { container } = render(<SmsTwoFactorSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a web-only note on native", () => {
    m.native.mockReturnValue(true);
    render(<SmsTwoFactorSection />);
    expect(screen.getByText(/not available in the app yet/)).toBeInTheDocument();
  });

  it("requires a phone number", async () => {
    await startEnroll("");
    expect(screen.getByText("Enter your phone number")).toBeInTheDocument();
    expect(m.begin).not.toHaveBeenCalled();
  });

  it("enrolls end to end", async () => {
    m.list.mockReturnValueOnce([]).mockReturnValue([factor]);
    const u = await startEnroll();
    expect(screen.getByText(/6-digit code sent to 5551234567/)).toBeInTheDocument();
    await u.type(screen.getByPlaceholderText("123456"), "12a3456");
    await u.click(screen.getByText("Verify"));
    expect(m.confirm).toHaveBeenCalledWith("vid", "123456");
    expect(screen.getByText("+15551234567")).toBeInTheDocument();
  });

  it("shows a confirm error", async () => {
    m.confirm.mockRejectedValue(err("auth/invalid-verification-code", "That code didn't match."));
    const u = await startEnroll();
    await u.type(screen.getByPlaceholderText("123456"), "123456");
    await u.click(screen.getByText("Verify"));
    expect(screen.getByText("That code didn't match.")).toBeInTheDocument();
  });

  it("switches to the unavailable note", async () => {
    m.begin.mockRejectedValue(err("mfa/unavailable"));
    await startEnroll();
    expect(screen.getByText("SMS two-step verification isn't available yet.")).toBeInTheDocument();
  });

  it("shows a non-reauth begin error and leaves enroll mode", async () => {
    m.begin.mockRejectedValue("weird");
    await startEnroll();
    expect(screen.getByText("Something went wrong. Try again.")).toBeInTheDocument();
    expect(screen.getByText("Set up text codes")).toBeInTheDocument();
  });

  it("re-authenticates with a password then resends the code", async () => {
    m.begin.mockRejectedValueOnce(err("auth/requires-recent-login", "Confirm it's you"));
    const u = await startEnroll();
    await u.click(screen.getByText("Confirm"));
    expect(screen.getByText("Enter your password")).toBeInTheDocument();
    await u.type(screen.getByPlaceholderText("Your password"), "pw");
    await u.click(screen.getByText("Confirm"));
    expect(m.reauth).toHaveBeenCalledWith("pw");
    expect(m.begin).toHaveBeenCalledTimes(2);
    expect(screen.getByPlaceholderText("123456")).toBeInTheDocument();
  });

  it("shows a reauth failure and can cancel", async () => {
    m.method.mockReturnValue("google");
    m.begin.mockRejectedValueOnce(err("auth/requires-recent-login"));
    m.reauth.mockRejectedValue(new Error("popup closed"));
    const u = await startEnroll();
    await u.click(screen.getByText("Re-authenticate"));
    expect(screen.getByText("popup closed")).toBeInTheDocument();
    await u.click(screen.getByText("Cancel"));
    expect(screen.getByText("Set up text codes")).toBeInTheDocument();
  });

  it("removes an enrolled phone", async () => {
    m.list.mockReturnValueOnce([factor]).mockReturnValue([]);
    const u = userEvent.setup();
    render(<SmsTwoFactorSection />);
    await u.click(screen.getByText("Remove"));
    expect(m.unenroll).toHaveBeenCalledWith("f1");
    expect(screen.getByText("Set up text codes")).toBeInTheDocument();
  });

  it("re-authenticates before removing", async () => {
    m.list.mockReturnValueOnce([factor]).mockReturnValueOnce([factor]).mockReturnValue([]);
    m.unenroll.mockRejectedValueOnce(err("auth/requires-recent-login"));
    const u = userEvent.setup();
    render(<SmsTwoFactorSection />);
    await u.click(screen.getByText("Remove"));
    await u.type(screen.getByPlaceholderText("Your password"), "pw");
    await u.click(screen.getByText("Confirm"));
    expect(m.unenroll).toHaveBeenCalledTimes(2);
  });

  it("shows a plain remove error", async () => {
    m.list.mockReturnValue([{ ...factor, phoneNumber: "" }]);
    m.unenroll.mockRejectedValue(new Error("nope"));
    const u = userEvent.setup();
    render(<SmsTwoFactorSection />);
    expect(screen.getByText("Phone")).toBeInTheDocument();
    await u.click(screen.getByText("Remove"));
    expect(screen.getByText("nope")).toBeInTheDocument();
  });
});
