import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toast } from "../Toast";

vi.mock("../../lib/notificationMeta", () => ({
  notificationIcon: { game_event: "🎮", success: "✅", error: "❌", info: "ℹ️" },
  notificationAccentBg: { game_event: "bg-orange", success: "bg-green", error: "bg-red", info: "bg-blue" },
  notificationAccentText: { game_event: "text-orange", success: "text-green", error: "text-red", info: "text-blue" },
}));

const notification = {
  id: "n1",
  type: "game_event" as const,
  title: "Your Turn!",
  message: "Match the kickflip",
  timestamp: Date.now(),
  read: false,
};

// jsdom doesn't implement pointer capture
beforeAll(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

describe("Toast", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders title and message", () => {
    render(<Toast notification={notification} onDismiss={vi.fn()} />);
    expect(screen.getByText("Your Turn!")).toBeInTheDocument();
    expect(screen.getByText("Match the kickflip")).toBeInTheDocument();
  });

  it("renders with status role", () => {
    render(<Toast notification={notification} onDismiss={vi.fn()} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has a dismiss button", () => {
    render(<Toast notification={notification} onDismiss={vi.fn()} />);
    expect(screen.getByLabelText("Dismiss notification")).toBeInTheDocument();
  });

  it("calls onDismiss after clicking dismiss button and animation delay", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onDismiss = vi.fn();
    render(<Toast notification={notification} onDismiss={onDismiss} />);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByLabelText("Dismiss notification"));

    // Exit animation takes 250ms
    vi.advanceTimersByTime(300);
    expect(onDismiss).toHaveBeenCalledWith("n1");
    vi.useRealTimers();
  });

  it("applies toast-in class by default and toast-out when exiting", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onDismiss = vi.fn();
    render(<Toast notification={notification} onDismiss={onDismiss} />);

    const el = screen.getByRole("status");
    expect(el.className).toContain("animate-toast-in");

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByLabelText("Dismiss notification"));
    expect(el.className).toContain("animate-toast-out");
    vi.useRealTimers();
  });

  it("handles pointer swipe to dismiss when exceeding threshold", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onDismiss = vi.fn();
    render(<Toast notification={notification} onDismiss={onDismiss} />);

    const el = screen.getByRole("status");
    fireEvent.pointerDown(el, { clientX: 0 });
    fireEvent.pointerMove(el, { clientX: 100 }); // > 80 threshold
    fireEvent.pointerUp(el);

    vi.advanceTimersByTime(300);
    expect(onDismiss).toHaveBeenCalledWith("n1");
    vi.useRealTimers();
  });

  it("resets drag when swipe does not exceed threshold", () => {
    const onDismiss = vi.fn();
    render(<Toast notification={notification} onDismiss={onDismiss} />);

    const el = screen.getByRole("status");
    fireEvent.pointerDown(el, { clientX: 0 });
    fireEvent.pointerMove(el, { clientX: 30 }); // < 80 threshold
    fireEvent.pointerUp(el);

    // Should not trigger dismiss
    expect(onDismiss).not.toHaveBeenCalled();
    // Transform should be reset (no inline style)
    expect(el.style.transform).toBe("");
  });

  it("ignores leftward pointer movement", () => {
    const onDismiss = vi.fn();
    render(<Toast notification={notification} onDismiss={onDismiss} />);

    const el = screen.getByRole("status");
    fireEvent.pointerDown(el, { clientX: 100 });
    fireEvent.pointerMove(el, { clientX: 50 }); // negative dx
    fireEvent.pointerUp(el);

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("ignores pointer move without pointer down", () => {
    render(<Toast notification={notification} onDismiss={vi.fn()} />);
    const el = screen.getByRole("status");
    fireEvent.pointerMove(el, { clientX: 200 });
    // Should not throw or change state
    expect(el.style.transform).toBe("");
  });
});
