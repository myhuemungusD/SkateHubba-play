import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VerifyEmailBanner } from "../VerifyEmailBanner";

const mockResendVerification = vi.fn();
vi.mock("../../services/auth", () => ({
  resendVerification: (...args: unknown[]) => mockResendVerification(...args),
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

  it("shows error state and Retry when resend fails", async () => {
    mockResendVerification.mockRejectedValueOnce(new Error("network"));
    render(<VerifyEmailBanner emailVerified={false} />);

    await userEvent.click(screen.getByText("Resend"));

    await waitFor(() => {
      expect(screen.getByText("Failed to send — check your connection.")).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
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
});
