import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MfaVerifyCard } from "../MfaVerifyCard";
import type { MfaChallenge } from "../../services/mfa";

const mockStartSms = vi.fn();
const mockCompleteSms = vi.fn();
const mockCompleteTotp = vi.fn();

vi.mock("../../services/mfa", () => ({
  startSmsMfaSignIn: (...args: unknown[]) => mockStartSms(...args),
  completeSmsMfaSignIn: (...args: unknown[]) => mockCompleteSms(...args),
  completeTotpMfaSignIn: (...args: unknown[]) => mockCompleteTotp(...args),
  hintPhoneNumber: (h: { phoneNumber?: unknown }) => (typeof h.phoneNumber === "string" ? h.phoneNumber : ""),
  isPhoneHint: (h: { factorId: string }) => h.factorId === "phone",
  isTotpHint: (h: { factorId: string }) => h.factorId === "totp",
}));

const mockLoggerWarn = vi.fn();
vi.mock("../../services/logger", () => ({
  logger: { info: vi.fn(), warn: (...args: unknown[]) => mockLoggerWarn(...args), error: vi.fn(), debug: vi.fn() },
}));

type Hint = { uid: string; factorId: string; displayName: string | null; phoneNumber?: string };

/** Build a challenge whose resolver is irrelevant — every call that would use
 *  it goes through the mocked service. */
function makeChallenge(hints: Hint[]): MfaChallenge {
  return { resolver: { hints, session: {} }, hints } as unknown as MfaChallenge;
}

const totpHint: Hint = { uid: "totp-1", factorId: "totp", displayName: "Authenticator" };
const phoneHint: Hint = { uid: "sms-1", factorId: "phone", displayName: null, phoneNumber: "+1 •••••1234" };

const onDone = vi.fn();
const onCancel = vi.fn();

function renderCard(hints: Hint[]) {
  return render(<MfaVerifyCard challenge={makeChallenge(hints)} onDone={onDone} onCancel={onCancel} />);
}

async function submitCode(value: string) {
  await userEvent.type(screen.getByPlaceholderText("123456"), value);
  await userEvent.click(screen.getByRole("button", { name: "Verify" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStartSms.mockResolvedValue("verification-id-1");
  mockCompleteTotp.mockResolvedValue({ uid: "u1" });
  mockCompleteSms.mockResolvedValue({ uid: "u1" });
});

// The resend-cooldown test drives fake timers; every other test (and
// userEvent) needs the real ones back.
afterEach(() => {
  vi.useRealTimers();
});

describe("MfaVerifyCard", () => {
  describe("TOTP factor", () => {
    it("verifies the typed code and reports completion", async () => {
      const challenge = makeChallenge([totpHint]);
      render(<MfaVerifyCard challenge={challenge} onDone={onDone} onCancel={onCancel} />);

      expect(screen.getByText(/code from your authenticator app/)).toBeInTheDocument();
      await submitCode("123456");

      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
      expect(mockCompleteTotp).toHaveBeenCalledWith(challenge, totpHint, "123456");
      // TOTP is single-step: no SMS is ever sent.
      expect(mockStartSms).not.toHaveBeenCalled();
    });

    it("rejects an empty code without calling the service", async () => {
      renderCard([totpHint]);
      await userEvent.click(screen.getByRole("button", { name: "Verify" }));

      expect(screen.getByText("Enter the code to continue.")).toBeInTheDocument();
      expect(mockCompleteTotp).not.toHaveBeenCalled();
    });

    it("maps an invalid code to retry copy and never logs the typed digits", async () => {
      mockCompleteTotp.mockRejectedValueOnce({ code: "auth/invalid-verification-code" });
      renderCard([totpHint]);
      await submitCode("000000");

      await waitFor(() => expect(screen.getByText("That code didn't match. Try again.")).toBeInTheDocument());
      expect(onDone).not.toHaveBeenCalled();
      expect(JSON.stringify(mockLoggerWarn.mock.calls)).not.toContain("000000");
    });

    it("falls back to the shared mapper for rate limiting", async () => {
      mockCompleteTotp.mockRejectedValueOnce({ code: "auth/too-many-requests" });
      renderCard([totpHint]);
      await submitCode("222222");

      await waitFor(() => expect(screen.getByText(/Too many attempts/)).toBeInTheDocument());
    });

    it("falls back to generic copy for an unmapped code", async () => {
      mockCompleteTotp.mockRejectedValueOnce({ code: "auth/some-new-code" });
      renderCard([totpHint]);
      await submitCode("333333");

      await waitFor(() => expect(screen.getByText("Verification failed. Please try again.")).toBeInTheDocument());
    });

    it("dismisses the error banner", async () => {
      mockCompleteTotp.mockRejectedValueOnce({ code: "auth/code-expired" });
      renderCard([totpHint]);
      await submitCode("444444");

      await waitFor(() => expect(screen.getByText("That code expired. Request a new one.")).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
      expect(screen.queryByText("That code expired. Request a new one.")).not.toBeInTheDocument();
    });
  });

  describe("phone factor", () => {
    it("sends the code once on mount and verifies with the stored verificationId", async () => {
      const challenge = makeChallenge([phoneHint]);
      render(<MfaVerifyCard challenge={challenge} onDone={onDone} onCancel={onCancel} />);

      await waitFor(() => expect(mockStartSms).toHaveBeenCalledTimes(1));
      expect(mockStartSms).toHaveBeenCalledWith(challenge, phoneHint, expect.any(HTMLDivElement));
      // Masked number comes straight from Firebase — safe to echo back.
      expect(screen.getByText(/\+1 •••••1234/)).toBeInTheDocument();

      await submitCode("654321");

      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
      expect(mockCompleteSms).toHaveBeenCalledWith(challenge, "verification-id-1", "654321");
    });

    it("offers a resend after a failed send and retries the send", async () => {
      mockStartSms.mockRejectedValueOnce({ code: "auth/too-many-requests" });
      renderCard([phoneHint]);

      const resend = await screen.findByRole("button", { name: "Resend code" });
      expect(screen.getByText(/Too many attempts/)).toBeInTheDocument();

      await userEvent.click(resend);
      await waitFor(() => expect(mockStartSms).toHaveBeenCalledTimes(2));
    });

    it("re-offers the resend after a cooldown when the SMS never arrives", async () => {
      // The send succeeded, so nothing fails — but the SMS can still silently
      // never land. Without the cooldown the only way to reach the resend was
      // to submit a code the user does not have.
      vi.useFakeTimers();
      renderCard([phoneHint]);
      await act(async () => {});

      expect(mockStartSms).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "Resend code" })).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(screen.getByRole("button", { name: "Resend code" })).toBeInTheDocument();
    });

    it("refuses to verify with no verificationId and points at the resend", async () => {
      // The initial send failed, so verificationId is still "". Handing that to
      // the SDK only buys an unmapped auth/missing-verification-id.
      mockStartSms.mockRejectedValueOnce({ code: "auth/too-many-requests" });
      renderCard([phoneHint]);
      await screen.findByRole("button", { name: "Resend code" });

      await submitCode("123456");

      expect(screen.getByText("Request a new code first.")).toBeInTheDocument();
      expect(mockCompleteSms).not.toHaveBeenCalled();
    });

    it("offers a resend after a failed verification", async () => {
      mockCompleteSms.mockRejectedValueOnce({ code: "auth/code-expired" });
      renderCard([phoneHint]);
      await waitFor(() => expect(mockStartSms).toHaveBeenCalled());

      await submitCode("111111");

      expect(await screen.findByRole("button", { name: "Resend code" })).toBeInTheDocument();
      expect(screen.getByText("That code expired. Request a new one.")).toBeInTheDocument();
    });
  });

  describe("factor picker", () => {
    it("lists every enrolled factor and sends no code until one is chosen", async () => {
      renderCard([phoneHint, totpHint]);

      expect(screen.getByText("Choose how you want to verify.")).toBeInTheDocument();
      expect(mockStartSms).not.toHaveBeenCalled();
      // Falls back to the masked number when the factor has no display name.
      expect(screen.getByRole("button", { name: "+1 •••••1234" })).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Authenticator" }));

      expect(screen.getByText(/code from your authenticator app/)).toBeInTheDocument();
      expect(mockStartSms).not.toHaveBeenCalled();
    });

    it("sends the SMS once the phone factor is picked", async () => {
      renderCard([phoneHint, totpHint]);

      await userEvent.click(screen.getByRole("button", { name: "+1 •••••1234" }));

      await waitFor(() => expect(mockStartSms).toHaveBeenCalledTimes(1));
    });

    it("labels a nameless factor by type", () => {
      renderCard([
        { uid: "a", factorId: "totp", displayName: null },
        { uid: "b", factorId: "unknown", displayName: null },
      ]);

      expect(screen.getByRole("button", { name: "Authenticator app" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Second factor" })).toBeInTheDocument();
    });
  });

  it("routes the back link to onCancel", async () => {
    renderCard([totpHint]);
    await userEvent.click(screen.getByRole("button", { name: "Back to sign in" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});
