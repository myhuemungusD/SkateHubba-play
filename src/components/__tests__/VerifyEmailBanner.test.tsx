import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VerifyEmailBanner } from "../VerifyEmailBanner";

const mockResendVerification = vi.fn();
const mockReloadUser = vi.fn();
vi.mock("../../services/auth", () => ({
  resendVerification: (...args: unknown[]) => mockResendVerification(...args),
  reloadUser: (...args: unknown[]) => mockReloadUser(...args),
}));
vi.mock("../../utils/helpers", () => ({
  getErrorCode: (err: unknown) => (err as { code?: string })?.code ?? null,
  parseFirebaseError: (err: unknown) => (err as Error)?.message ?? "Unknown error",
}));
vi.mock("../../lib/sentry", () => ({
  captureException: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("VerifyEmailBanner", () => {
  it("returns null when emailVerified is true", () => {
    const { container } = render(<VerifyEmailBanner emailVerified={true} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders banner when emailVerified is false", () => {
    render(<VerifyEmailBanner emailVerified={false} />);
    expect(screen.getByText("VERIFY YOUR EMAIL")).toBeInTheDocument();
    expect(screen.getByText("Resend")).toBeInTheDocument();
  });

  it("calls resendVerification and shows cooldown", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockResendVerification.mockResolvedValueOnce(undefined);
    render(<VerifyEmailBanner emailVerified={false} />);

    await act(async () => {
      await userEvent.click(screen.getByText("Resend"));
    });

    await waitFor(() => {
      expect(mockResendVerification).toHaveBeenCalled();
      // Shows cooldown timer
      expect(screen.getByRole("button", { name: /Resend available in/ })).toBeDisabled();
    });

    vi.useRealTimers();
  });

  it("shows error state and applies 60s cooldown on generic resend failure", async () => {
    // Regression: previously the resend button was left spammable on any
    // non-`auth/too-many-requests` error, so users would hammer the button
    // until Firebase escalated them into the 5-minute rate-limit cooldown.
    // Any error must trigger the standard 60s cooldown.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockResendVerification.mockRejectedValueOnce(new Error("network"));
    render(<VerifyEmailBanner emailVerified={false} />);

    await act(async () => {
      await userEvent.click(screen.getByText("Resend"));
    });

    await waitFor(() => {
      expect(screen.getByText("Failed to send — check your connection.")).toBeInTheDocument();
      // Button shows the 60s cooldown timer and is disabled — not "Retry".
      expect(screen.getByText("60s")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Resend available in/ })).toBeDisabled();
    });

    // Cooldown persisted to localStorage so it survives a page refresh.
    expect(localStorage.getItem("skatehubba_resend_cooldown_until")).toBeTruthy();

    vi.useRealTimers();
  });

  it("applies 5-minute cooldown on auth/too-many-requests", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockResendVerification.mockRejectedValueOnce({ code: "auth/too-many-requests" });
    render(<VerifyEmailBanner emailVerified={false} />);

    await act(async () => {
      await userEvent.click(screen.getByText("Resend"));
    });

    await waitFor(() => {
      expect(screen.getByText("Too many attempts — please wait 5 minutes before retrying.")).toBeInTheDocument();
      expect(screen.getByText("300s")).toBeInTheDocument();
      // Multiple buttons exist now (resend + manual "check now"); disambiguate.
      expect(screen.getByRole("button", { name: /Resend available in/ })).toBeDisabled();
    });

    // Cooldown persisted to localStorage
    expect(localStorage.getItem("skatehubba_resend_cooldown_until")).toBeTruthy();

    vi.useRealTimers();
  });

  it("persists cooldown in localStorage across remounts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockResendVerification.mockResolvedValueOnce(undefined);
    const { unmount } = render(<VerifyEmailBanner emailVerified={false} />);

    await act(async () => {
      await userEvent.click(screen.getByText("Resend"));
    });

    await waitFor(() => {
      expect(screen.getByText("60s")).toBeInTheDocument();
    });

    // Stored in localStorage
    expect(localStorage.getItem("skatehubba_resend_cooldown_until")).toBeTruthy();

    // Advance 10 seconds and remount — cooldown should survive
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    unmount();

    render(<VerifyEmailBanner emailVerified={false} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Resend available in/ })).toBeDisabled();
    });

    vi.useRealTimers();
  });

  it("shows success message after successful resend", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockResendVerification.mockResolvedValueOnce(undefined);
    render(<VerifyEmailBanner emailVerified={false} />);

    // Before resend, shows default copy with spam/junk mention
    expect(screen.getByText("Check your inbox and spam/junk folder for the verification link.")).toBeInTheDocument();

    await act(async () => {
      await userEvent.click(screen.getByText("Resend"));
    });

    await waitFor(() => {
      expect(screen.getByText("Sent! Check your inbox and spam/junk folder.")).toBeInTheDocument();
    });

    // Default copy is no longer shown
    expect(
      screen.queryByText("Check your inbox and spam/junk folder for the verification link."),
    ).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("cooldown counts down", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockResendVerification.mockResolvedValueOnce(undefined);
    render(<VerifyEmailBanner emailVerified={false} />);

    await act(async () => {
      await userEvent.click(screen.getByText("Resend"));
    });

    await waitFor(() => {
      expect(screen.getByText("60s")).toBeInTheDocument();
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(screen.getByText("59s")).toBeInTheDocument();
    });

    vi.useRealTimers();
  });

  it("banner container is announced as a status region", () => {
    // Screen reader users need to know the banner is present even though it
    // isn't the primary landmark on the page.
    render(<VerifyEmailBanner emailVerified={false} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("VERIFY YOUR EMAIL");
  });

  it("resend button reflects aria-busy + label swap while sending", async () => {
    // In-flight sends must be announced so assistive tech doesn't just see a
    // silently disabled button. The aria-label swaps to "Sending verification
    // email" for the duration of the request and restores after.
    let resolveSend: () => void = () => {};
    mockResendVerification.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolveSend = r;
        }),
    );
    render(<VerifyEmailBanner emailVerified={false} />);

    await userEvent.click(screen.getByText("Resend"));

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: "Sending verification email" });
      expect(btn).toHaveAttribute("aria-busy", "true");
    });

    await act(async () => {
      resolveSend();
    });

    await waitFor(() => {
      const cooldownBtn = screen.getByRole("button", { name: /Resend available in/ });
      expect(cooldownBtn).toHaveAttribute("aria-busy", "false");
    });
  });

  it("manual 'I verified' button calls reloadUser", async () => {
    // Desktop users with side-by-side tabs never fire visibilitychange, so
    // they need a manual affordance to force useAuth to refresh the token.
    mockReloadUser.mockResolvedValueOnce(true);
    render(<VerifyEmailBanner emailVerified={false} />);

    const btn = screen.getByRole("button", { name: /I verified my email/ });
    await userEvent.click(btn);

    await waitFor(() => {
      expect(mockReloadUser).toHaveBeenCalledTimes(1);
    });
  });

  it("manual 'I verified' button prefers onManualReload over the bare service", async () => {
    // When wired to AuthContext.reloadAuthUser (which bumps useAuth's reload
    // tick to force a re-render), the click must route through that handler and
    // NOT the bare service reloadUser — the bare path mutates the User in place
    // without triggering a render, leaving the banner and gating stale.
    const onManualReload = vi.fn().mockResolvedValue(true);
    render(<VerifyEmailBanner emailVerified={false} onManualReload={onManualReload} />);

    const btn = screen.getByRole("button", { name: /I verified my email/ });
    await userEvent.click(btn);

    await waitFor(() => {
      expect(onManualReload).toHaveBeenCalledTimes(1);
    });
    expect(mockReloadUser).not.toHaveBeenCalled();
  });

  it("manual 'I verified' button swallows reloadUser errors", async () => {
    // Manual refresh is best-effort — a network blip must not throw an
    // unhandled promise rejection or leave the button stuck in "Checking…".
    mockReloadUser.mockRejectedValueOnce(new Error("network"));
    render(<VerifyEmailBanner emailVerified={false} />);

    const btn = screen.getByRole("button", { name: /I verified my email/ });
    await userEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /I verified my email/ })).not.toBeDisabled();
    });
  });
});
