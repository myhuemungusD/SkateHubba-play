import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MultiFactorInfo, TotpSecret } from "firebase/auth";

const listTotpFactors = vi.fn();
const beginTotpEnrollment = vi.fn();
const confirmTotpEnrollment = vi.fn();
const unenrollTotpFactor = vi.fn();
const reauthMethod = vi.fn();
const reauthenticateForMfa = vi.fn();
const toDataURL = vi.fn();

vi.mock("qrcode", () => ({
  default: { toDataURL: (...args: unknown[]) => toDataURL(...args) },
}));

vi.mock("../../services/mfa.enroll", () => ({
  MFA_UNAVAILABLE: "mfa/unavailable",
  listTotpFactors: () => listTotpFactors(),
  beginTotpEnrollment: (...args: unknown[]) => beginTotpEnrollment(...args),
  confirmTotpEnrollment: (...args: unknown[]) => confirmTotpEnrollment(...args),
  unenrollTotpFactor: (...args: unknown[]) => unenrollTotpFactor(...args),
  reauthMethod: () => reauthMethod(),
  reauthenticateForMfa: (...args: unknown[]) => reauthenticateForMfa(...args),
}));

import { TwoFactorSection } from "../TwoFactorSection";

const secret = { secretKey: "SECRETKEY" } as TotpSecret;
const factor: MultiFactorInfo = {
  uid: "factor-1",
  displayName: "Authenticator app",
  enrollmentTime: "Mon, 01 Jan 2026 00:00:00 GMT",
  factorId: "totp",
};

function recentLogin(): Error {
  return Object.assign(new Error("Confirm it's you, then try again."), { code: "auth/requires-recent-login" });
}

beforeEach(() => {
  vi.clearAllMocks();
  listTotpFactors.mockReturnValue([]);
  reauthMethod.mockReturnValue("password");
  toDataURL.mockResolvedValue("data:image/png;base64,qr");
  beginTotpEnrollment.mockResolvedValue({ secret, secretKey: "SECRETKEY", qrCodeUrl: "otpauth://totp/x" });
  confirmTotpEnrollment.mockResolvedValue(undefined);
  unenrollTotpFactor.mockResolvedValue(undefined);
  reauthenticateForMfa.mockResolvedValue(undefined);
});

describe("TwoFactorSection", () => {
  it("starts enrollment and shows the QR code and manual key", async () => {
    const user = userEvent.setup();
    render(<TwoFactorSection />);
    await user.click(screen.getByRole("button", { name: "Set up authenticator app" }));
    expect(await screen.findByAltText("QR code for your authenticator app")).toHaveAttribute(
      "src",
      "data:image/png;base64,qr",
    );
    expect(screen.getByTestId("totp-manual-key")).toHaveTextContent("SECRETKEY");
  });

  it("keeps the manual key when the QR image cannot be built", async () => {
    toDataURL.mockRejectedValue(new Error("canvas"));
    const user = userEvent.setup();
    render(<TwoFactorSection />);
    await user.click(screen.getByRole("button", { name: "Set up authenticator app" }));
    expect(await screen.findByText(/Enter the key below/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("verifies the code and shows the enrolled state", async () => {
    const user = userEvent.setup();
    listTotpFactors.mockReturnValueOnce([]).mockReturnValue([factor]);
    render(<TwoFactorSection />);
    await user.click(screen.getByRole("button", { name: "Set up authenticator app" }));
    await user.type(await screen.findByLabelText("AUTHENTICATOR CODE"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify code" }));
    expect(confirmTotpEnrollment).toHaveBeenCalledWith(secret, "123456");
    expect(await screen.findByText("Authenticator app is on.")).toBeInTheDocument();
  });

  it("shows a not-available-yet state when the project has TOTP switched off", async () => {
    beginTotpEnrollment.mockRejectedValue(
      Object.assign(new Error("Two-step verification isn't available yet."), { code: "mfa/unavailable" }),
    );
    const user = userEvent.setup();
    render(<TwoFactorSection />);
    await user.click(screen.getByRole("button", { name: "Set up authenticator app" }));
    expect(await screen.findByTestId("two-factor-unavailable")).toHaveTextContent(
      "Two-step verification isn't available yet.",
    );
  });

  it("asks for the password after a recent-login failure, then continues setup", async () => {
    beginTotpEnrollment.mockRejectedValueOnce(recentLogin()).mockResolvedValueOnce({
      secret,
      secretKey: "SECRETKEY",
      qrCodeUrl: "otpauth://totp/x",
    });
    const user = userEvent.setup();
    render(<TwoFactorSection />);
    await user.click(screen.getByRole("button", { name: "Set up authenticator app" }));
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Confirm password" }));
    expect(reauthenticateForMfa).toHaveBeenCalledWith("hunter2");
    expect(await screen.findByTestId("totp-manual-key")).toBeInTheDocument();
  });

  it("confirms with Google when that is the sign-in method", async () => {
    reauthMethod.mockReturnValue("google");
    beginTotpEnrollment.mockRejectedValueOnce(recentLogin());
    const user = userEvent.setup();
    render(<TwoFactorSection />);
    await user.click(screen.getByRole("button", { name: "Set up authenticator app" }));
    await user.click(await screen.findByRole("button", { name: "Confirm with Google" }));
    expect(reauthenticateForMfa).toHaveBeenCalled();
  });

  it("confirms with Apple when that is the sign-in method", async () => {
    reauthMethod.mockReturnValue("apple");
    beginTotpEnrollment.mockRejectedValueOnce(recentLogin());
    const user = userEvent.setup();
    render(<TwoFactorSection />);
    await user.click(screen.getByRole("button", { name: "Set up authenticator app" }));
    expect(await screen.findByRole("button", { name: "Confirm with Apple" })).toBeInTheDocument();
  });

  it("tells the player to sign in again when re-auth is unsupported", async () => {
    reauthMethod.mockReturnValue("unsupported");
    beginTotpEnrollment.mockRejectedValueOnce(recentLogin());
    const user = userEvent.setup();
    render(<TwoFactorSection />);
    await user.click(screen.getByRole("button", { name: "Set up authenticator app" }));
    expect(await screen.findByText(/Sign out and sign back in/i)).toBeInTheDocument();
  });

  it("shows an error when the code is rejected", async () => {
    confirmTotpEnrollment.mockRejectedValue(new Error("That code didn't match. Check the app and try again."));
    const user = userEvent.setup();
    render(<TwoFactorSection />);
    await user.click(screen.getByRole("button", { name: "Set up authenticator app" }));
    await user.type(await screen.findByLabelText("AUTHENTICATOR CODE"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/didn't match/i);
  });

  it("turns an enrolled factor off", async () => {
    listTotpFactors.mockReturnValueOnce([factor]).mockReturnValue([]);
    const user = userEvent.setup();
    render(<TwoFactorSection />);
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    expect(unenrollTotpFactor).toHaveBeenCalledWith("factor-1");
    expect(await screen.findByRole("button", { name: "Set up authenticator app" })).toBeInTheDocument();
  });

  it("re-authenticates before turning a factor off", async () => {
    listTotpFactors.mockReturnValue([factor]);
    unenrollTotpFactor.mockRejectedValueOnce(recentLogin()).mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<TwoFactorSection />);
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    await user.type(await screen.findByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Confirm password" }));
    expect(unenrollTotpFactor).toHaveBeenCalledTimes(2);
  });

  it("shows a re-auth failure", async () => {
    beginTotpEnrollment.mockRejectedValueOnce(recentLogin());
    reauthenticateForMfa.mockRejectedValue(new Error("Wrong password."));
    const user = userEvent.setup();
    render(<TwoFactorSection />);
    await user.click(screen.getByRole("button", { name: "Set up authenticator app" }));
    await user.click(await screen.findByRole("button", { name: "Confirm password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong password.");
  });

  it("shows a non-Error failure as a generic message", async () => {
    beginTotpEnrollment.mockRejectedValue("nope");
    const user = userEvent.setup();
    render(<TwoFactorSection />);
    await user.click(screen.getByRole("button", { name: "Set up authenticator app" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
  });
});
