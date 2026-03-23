import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastContainer } from "../ToastContainer";

const mockDismissToast = vi.fn();

vi.mock("../../context/NotificationContext", () => ({
  useNotifications: vi.fn(() => ({
    toasts: [],
    dismissToast: mockDismissToast,
  })),
}));

vi.mock("../../lib/notificationMeta", () => ({
  notificationIcon: { game_event: "🎮", success: "✅", error: "❌", info: "ℹ️" },
  notificationAccentBg: { game_event: "bg-orange", success: "bg-green", error: "bg-red", info: "bg-blue" },
  notificationAccentText: { game_event: "text-orange", success: "text-green", error: "text-red", info: "text-blue" },
}));

import { useNotifications } from "../../context/NotificationContext";

describe("ToastContainer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when there are no toasts", () => {
    const { container } = render(<ToastContainer />);
    expect(container.firstChild).toBeNull();
  });

  it("renders toasts when present", () => {
    vi.mocked(useNotifications).mockReturnValue({
      toasts: [
        { id: "t1", type: "game_event", title: "Your Turn!", message: "Go", timestamp: Date.now(), read: false },
        { id: "t2", type: "success", title: "You Won!", message: "GG", timestamp: Date.now(), read: false },
      ],
      dismissToast: mockDismissToast,
    } as unknown as ReturnType<typeof useNotifications>);

    render(<ToastContainer />);
    expect(screen.getByText("Your Turn!")).toBeInTheDocument();
    expect(screen.getByText("You Won!")).toBeInTheDocument();
  });

  it("renders with notifications aria-label", () => {
    vi.mocked(useNotifications).mockReturnValue({
      toasts: [{ id: "t1", type: "info", title: "Info", message: "msg", timestamp: Date.now(), read: false }],
      dismissToast: mockDismissToast,
    } as unknown as ReturnType<typeof useNotifications>);

    render(<ToastContainer />);
    expect(screen.getByLabelText("Notifications")).toBeInTheDocument();
  });
});
