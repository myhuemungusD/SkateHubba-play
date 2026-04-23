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
  dismissNotification: vi.fn(),
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

  it("shows unmute label when sound is disabled", async () => {
    mockNotifications.mockReturnValue({ ...baseCtx, soundEnabled: false });
    render(<NotificationBell />);
    await userEvent.click(screen.getByLabelText("Notifications"));
    expect(screen.getByLabelText("Unmute sounds")).toBeInTheDocument();
  });

  it("calls dismissNotification on delete button click", async () => {
    const dismissNotification = vi.fn();
    mockNotifications.mockReturnValue({
      ...baseCtx,
      dismissNotification,
      notifications: [
        {
          id: "n1",
          type: "game_event",
          title: "Test",
          message: "msg",
          timestamp: Date.now(),
          read: false,
          gameId: "g1",
        },
      ],
      unreadCount: 1,
    });

    render(<NotificationBell games={[{ id: "g1" } as any]} onOpenGame={vi.fn()} />);
    await userEvent.click(screen.getByLabelText("Notifications (1 unread)"));
    await userEvent.click(screen.getByLabelText("Delete notification"));
    expect(dismissNotification).toHaveBeenCalledWith("n1");
  });

  it("marks notification as read and opens game when clicked", async () => {
    const markRead = vi.fn();
    const onOpenGame = vi.fn();
    const game = { id: "g1" };
    mockNotifications.mockReturnValue({
      ...baseCtx,
      markRead,
      notifications: [
        {
          id: "n1",
          type: "game_event",
          title: "Test",
          message: "msg",
          timestamp: Date.now(),
          read: false,
          gameId: "g1",
        },
      ],
      unreadCount: 1,
    });

    render(<NotificationBell games={[game as any]} onOpenGame={onOpenGame} />);
    await userEvent.click(screen.getByLabelText("Notifications (1 unread)"));
    await userEvent.click(screen.getByText("Test"));
    expect(markRead).toHaveBeenCalledWith("n1");
    expect(onOpenGame).toHaveBeenCalledWith(game);
  });

  it("navigates to game when notification with gameId is clicked", async () => {
    const game = { id: "g1" };
    const onOpenGame = vi.fn();
    mockNotifications.mockReturnValue({
      ...baseCtx,
      notifications: [
        {
          id: "n1",
          type: "game_event",
          title: "Your Turn",
          message: "msg",
          timestamp: Date.now(),
          read: false,
          gameId: "g1",
        },
      ],
      unreadCount: 1,
    });

    render(<NotificationBell games={[game as any]} onOpenGame={onOpenGame} />);
    await userEvent.click(screen.getByLabelText("Notifications (1 unread)"));
    await userEvent.click(screen.getByText("Your Turn"));
    expect(onOpenGame).toHaveBeenCalledWith(game);
  });

  it("closes panel on outside click", async () => {
    render(
      <div>
        <NotificationBell />
        <button>Outside</button>
      </div>,
    );
    await userEvent.click(screen.getByLabelText("Notifications"));
    expect(screen.getByText("NOTIFICATIONS")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Outside"));
    expect(screen.queryByText("NOTIFICATIONS")).not.toBeInTheDocument();
  });

  it("shows read notifications with reduced opacity", async () => {
    mockNotifications.mockReturnValue({
      ...baseCtx,
      notifications: [
        { id: "n1", type: "game_event", title: "Read", message: "msg", timestamp: Date.now(), read: true },
      ],
    });

    render(<NotificationBell />);
    await userEvent.click(screen.getByLabelText("Notifications"));
    const item = screen.getByText("Read").closest('[role="button"]');
    expect(item?.className).toContain("opacity-60");
  });

  it("row is div[role='button'] (not a native <button>) so the delete button can nest safely", async () => {
    mockNotifications.mockReturnValue({
      ...baseCtx,
      notifications: [
        {
          id: "n1",
          type: "game_event",
          title: "Row",
          message: "msg",
          timestamp: Date.now(),
          read: false,
          gameId: "g1",
        },
      ],
      unreadCount: 1,
    });

    render(<NotificationBell games={[{ id: "g1" } as any]} onOpenGame={vi.fn()} />);
    await userEvent.click(screen.getByLabelText("Notifications (1 unread)"));

    const row = screen.getByText("Row").closest('[role="button"]');
    expect(row).not.toBeNull();
    expect(row?.tagName).toBe("DIV");
    // Delete button lives inside; the only inner <button> in the row
    const deleteBtn = row?.querySelector("button");
    expect(deleteBtn?.getAttribute("aria-label")).toBe("Delete notification");
  });

  it("activates row via Enter key", async () => {
    const game = { id: "g1" };
    const onOpenGame = vi.fn();
    const markRead = vi.fn();
    mockNotifications.mockReturnValue({
      ...baseCtx,
      markRead,
      notifications: [
        {
          id: "n1",
          type: "game_event",
          title: "Keyb",
          message: "msg",
          timestamp: Date.now(),
          read: false,
          gameId: "g1",
        },
      ],
      unreadCount: 1,
    });

    render(<NotificationBell games={[game as any]} onOpenGame={onOpenGame} />);
    await userEvent.click(screen.getByLabelText("Notifications (1 unread)"));

    const row = screen.getByText("Keyb").closest('[role="button"]') as HTMLElement;
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(markRead).toHaveBeenCalledWith("n1");
    expect(onOpenGame).toHaveBeenCalledWith(game);
  });

  it("activates row via Space key", async () => {
    const game = { id: "g1" };
    const onOpenGame = vi.fn();
    const markRead = vi.fn();
    mockNotifications.mockReturnValue({
      ...baseCtx,
      markRead,
      notifications: [
        {
          id: "n1",
          type: "game_event",
          title: "Spc",
          message: "msg",
          timestamp: Date.now(),
          read: false,
          gameId: "g1",
        },
      ],
      unreadCount: 1,
    });

    render(<NotificationBell games={[game as any]} onOpenGame={onOpenGame} />);
    await userEvent.click(screen.getByLabelText("Notifications (1 unread)"));

    const row = screen.getByText("Spc").closest('[role="button"]') as HTMLElement;
    row.focus();
    await userEvent.keyboard("[Space]");
    expect(markRead).toHaveBeenCalledWith("n1");
    expect(onOpenGame).toHaveBeenCalledWith(game);
  });

  it("non-clickable row has tabIndex -1 and aria-disabled true", async () => {
    mockNotifications.mockReturnValue({
      ...baseCtx,
      notifications: [
        { id: "n1", type: "game_event", title: "NoGame", message: "msg", timestamp: Date.now(), read: false },
      ],
      unreadCount: 1,
    });

    render(<NotificationBell />);
    await userEvent.click(screen.getByLabelText("Notifications (1 unread)"));

    const row = screen.getByText("NoGame").closest('[role="button"]');
    expect(row?.getAttribute("tabindex")).toBe("-1");
    expect(row?.getAttribute("aria-disabled")).toBe("true");
  });

  it("clicking a non-clickable row is a no-op (no markRead, no onOpenGame)", async () => {
    const markRead = vi.fn();
    const onOpenGame = vi.fn();
    mockNotifications.mockReturnValue({
      ...baseCtx,
      markRead,
      notifications: [
        { id: "n1", type: "game_event", title: "NoClick", message: "msg", timestamp: Date.now(), read: false },
      ],
      unreadCount: 1,
    });

    // No games array passed → clickable === false even though markRead is wired
    render(<NotificationBell onOpenGame={onOpenGame} />);
    await userEvent.click(screen.getByLabelText("Notifications (1 unread)"));
    await userEvent.click(screen.getByText("NoClick"));

    expect(markRead).not.toHaveBeenCalled();
    expect(onOpenGame).not.toHaveBeenCalled();
  });
});
