import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VerifyEmailBanner } from "../VerifyEmailBanner";

const mockResendVerification = vi.fn();
const mockRefreshUser = vi.fn();
vi.mock("../../services/auth", () => ({
  resendVerification: (...args: unknown[]) => mockResendVerification(...args),
}));
// The banner reads refreshUser off AuthContext (see the P0 fix in useAuth /
// AuthContext) — mocking the hook lets these tests stay decoupled from the
// full AuthProvider tree and its Firebase / router prerequisites.
vi.mock("../../context/AuthContext", () => ({
  useAuthContext: () => ({ refreshUser: mockRefreshUser }),
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

  it("status message is announced as a status region — but the ticking button is not", () => {
    // Screen reader users need to hear the message ("Check your inbox…") when
    // the banner appears. The role="status" MUST live on the message span, not
    // the outer container — the resend button below shows a live countdown
    // ("60s"→"59s"…) and wrapping the whole banner in a live region would
    // queue an announcement every second.
    render(<VerifyEmailBanner emailVerified={false} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/Check your inbox and spam\/junk folder/i);
    // Regression guard: the ticking Resend button must NOT be inside the
    // status region (would spam ATs with per-second announcements).
    expect(status).not.toContainElement(screen.getByRole("button", { name: /Resend verification email/ }));
  });

  it("banner is labelled by its title for screen readers", () => {
    render(<VerifyEmailBanner emailVerified={false} />);
    expect(screen.getByText("VERIFY YOUR EMAIL")).toHaveAttribute("id", "verify-email-banner-title");
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

  it("manual 'I verified' button calls refreshUser (via AuthContext, not the raw service)", async () => {
    // Desktop users with side-by-side tabs never fire visibilitychange, so
    // they need a manual affordance to force useAuth to refresh the token.
    // Critical wiring: the button must go through AuthContext.refreshUser
    // (which bumps useAuth's reload tick) — NOT the raw services/auth
    // reloadUser export. reloadUser mutates the SDK user in place; without
    // the tick bump the banner would not unmount after verification. This
    // test would fail if a future edit reintroduced the direct import.
    mockRefreshUser.mockResolvedValueOnce(true);
    render(<VerifyEmailBanner emailVerified={false} />);

    const btn = screen.getByRole("button", { name: /I verified my email/ });
    await userEvent.click(btn);

    await waitFor(() => {
      expect(mockRefreshUser).toHaveBeenCalledTimes(1);
    });
  });

  it("manual 'I verified' button clears its loading state even if refreshUser rejects", async () => {
    // Defense in depth — refreshUser is expected to swallow errors internally
    // (breadcrumbs via logger.debug) but if a future edit lets an exception
    // escape, the finally block on the button handler must still clear the
    // `checking` state so the button doesn't wedge on "Checking…".
    mockRefreshUser.mockRejectedValueOnce(new Error("network"));
    render(<VerifyEmailBanner emailVerified={false} />);

    const btn = screen.getByRole("button", { name: /I verified my email/ });
    await userEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /I verified my email/ })).not.toBeDisabled();
    });
  });
});
