import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Timer } from "../Timer";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Timer", () => {
  it("shows remaining time in h m s format", () => {
    const deadline = Date.now() + 3661000; // 1h 1m 1s
    render(<Timer deadline={deadline} />);
    expect(screen.getByText(/1h 1m 1s/)).toBeInTheDocument();
  });

  it("shows TIME'S UP when deadline has passed", () => {
    const deadline = Date.now() - 1000;
    render(<Timer deadline={deadline} />);
    expect(screen.getByText("TIME'S UP")).toBeInTheDocument();
  });

  it("updates every second and shows TIME'S UP when deadline expires", () => {
    // Timer calculates diff = deadline - Date.now(), then s = Math.floor((diff % 60000) / 1000)
    // With fake timers, Date.now() is frozen. 3000ms → shows "3s" initially.
    const deadline = Date.now() + 3000;
    render(<Timer deadline={deadline} />);

    expect(screen.getByText(/0h 0m 3s/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText(/0h 0m 2s/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText(/0h 0m 1s/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText("TIME'S UP")).toBeInTheDocument();
  });

  it("clears interval on unmount", () => {
    const deadline = Date.now() + 60000;
    const { unmount } = render(<Timer deadline={deadline} />);
    unmount();
    // No errors after unmount — interval was cleared
  });

  it("does not set interval when deadline is already past", () => {
    const deadline = Date.now() - 5000;
    render(<Timer deadline={deadline} />);
    expect(screen.getByText("TIME'S UP")).toBeInTheDocument();
    // Advancing timers should not cause issues
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("TIME'S UP")).toBeInTheDocument();
  });

  it("does not announce the per-second countdown to screen readers", () => {
    // The ticking value lives in an aria-label (read on demand), not a live
    // region, so a polite live region must NOT carry the changing countdown.
    // Well outside the 2-hour urgency window → calm, empty live region.
    const deadline = Date.now() + 5 * 60 * 60 * 1000;
    const { container } = render(<Timer deadline={deadline} />);
    expect(container.querySelector('[aria-live="polite"]')).toBeNull();
    // The only live region is the assertive urgency channel, empty while calm.
    const live = container.querySelector('[aria-live="assertive"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toBe("");
  });

  it("announces expiry via an assertive live region", () => {
    const deadline = Date.now() - 1000;
    const { container } = render(<Timer deadline={deadline} />);
    const live = container.querySelector('[aria-live="assertive"]');
    expect(live?.textContent).toBe("Turn timer expired");
  });

  it("announces urgency once when inside the final two-hour window", () => {
    const deadline = Date.now() + 60 * 60 * 1000; // 1h left → urgent
    const { container } = render(<Timer deadline={deadline} />);
    const live = container.querySelector('[aria-live="assertive"]');
    expect(live?.textContent).toBe("Less than two hours left on this turn");
    // Ticking a second keeps the same stable announcement string (no re-chatter).
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(live?.textContent).toBe("Less than two hours left on this turn");
  });
});
