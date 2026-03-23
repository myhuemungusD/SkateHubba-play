import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationBell } from "../NotificationBell";

const mockNotifications = vi.fn();

vi.mock("../../context/NotificationContext", () => ({
  useNotifications: () => mockNotifications(),
}));

vi.mock("../../lib/notificationMeta", () => ({
  notificationIcon: { game_event: "🎮", success: "✅", error: "❌", info: "ℹ️" },
  notificationAccentBg: { game_event: "bg-orange", success: "bg-green", error: "bg-red", info: "bg-blue" },
  notificationAccentText: { game_event: "text-orange", success: "text-green", error: "text-red", info: "text-blue" },
}));

const baseCtx = {
  notifications: [],
  toasts: [],
  unreadCount: 0,
  notifyKey: 0,
  notify: vi.fn(),
  dismissToast: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  clearAll: vi.fn(),
  soundEnabled: true,
  toggleSound: vi.fn(),
};

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifications.mockReturnValue({ ...baseCtx });
  });

  it("renders bell button", () => {
    render(<NotificationBell />);
    expect(screen.getByLabelText("Notifications")).toBeInTheDocument();
  });

  it("shows unread count badge when > 0", () => {
    mockNotifications.mockReturnValue({ ...baseCtx, unreadCount: 5 });
    render(<NotificationBell />);
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByLabelText("Notifications (5 unread)")).toBeInTheDocument();
  });

  it("shows 99+ for large unread counts", () => {
    mockNotifications.mockReturnValue({ ...baseCtx, unreadCount: 150 });
    render(<NotificationBell />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("opens dropdown on click", async () => {
    render(<NotificationBell />);
    await userEvent.click(screen.getByLabelText("Notifications"));
    expect(screen.getByText("NOTIFICATIONS")).toBeInTheDocument();
  });

  it("shows empty state when no notifications", async () => {
    render(<NotificationBell />);
    await userEvent.click(screen.getByLabelText("Notifications"));
    expect(screen.getByText("No notifications yet")).toBeInTheDocument();
  });

  it("renders notifications in dropdown", async () => {
    mockNotifications.mockReturnValue({
      ...baseCtx,
      notifications: [
        {
          id: "n1",
          type: "game_event",
          title: "Your Turn!",
          message: "Match kickflip",
          timestamp: Date.now(),
          read: false,
        },
      ],
      unreadCount: 1,
    });

    render(<NotificationBell />);
    await userEvent.click(screen.getByLabelText("Notifications (1 unread)"));
    expect(screen.getByText("Your Turn!")).toBeInTheDocument();
    expect(screen.getByText("Match kickflip")).toBeInTheDocument();
  });

  it("shows Mark all read button when there are unread", async () => {
    mockNotifications.mockReturnValue({
      ...baseCtx,
      notifications: [
        { id: "n1", type: "game_event", title: "Test", message: "msg", timestamp: Date.now(), read: false },
      ],
      unreadCount: 1,
    });

    render(<NotificationBell />);
    await userEvent.click(screen.getByLabelText("Notifications (1 unread)"));
    await userEvent.click(screen.getByText("Mark all read"));
    expect(baseCtx.markAllRead).toHaveBeenCalledTimes(1);
  });

  it("calls clearAll on Clear all click", async () => {
    mockNotifications.mockReturnValue({
      ...baseCtx,
      notifications: [
        { id: "n1", type: "game_event", title: "Test", message: "msg", timestamp: Date.now(), read: true },
      ],
    });

    render(<NotificationBell />);
    await userEvent.click(screen.getByLabelText("Notifications"));
    await userEvent.click(screen.getByText("Clear all"));
    expect(baseCtx.clearAll).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape key", async () => {
    render(<NotificationBell />);
    await userEvent.click(screen.getByLabelText("Notifications"));
    expect(screen.getByText("NOTIFICATIONS")).toBeInTheDocument();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(screen.queryByText("NOTIFICATIONS")).not.toBeInTheDocument();
  });

  it("toggles sound on sound button click", async () => {
    render(<NotificationBell />);
    await userEvent.click(screen.getByLabelText("Notifications"));
    await userEvent.click(screen.getByLabelText("Mute sounds"));
    expect(baseCtx.toggleSound).toHaveBeenCalledTimes(1);
  });
});
