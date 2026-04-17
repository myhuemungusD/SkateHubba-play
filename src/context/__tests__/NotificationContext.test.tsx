import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { NotificationProvider, useNotifications } from "../NotificationContext";

/* ── Mocks ─────────────────────────────────── */

const mockPlayChime = vi.fn();
const mockSetSoundEnabled = vi.fn();
let mockIsSoundEnabled = true;

vi.mock("../../services/sounds", () => ({
  playChime: (...args: unknown[]) => mockPlayChime(...args),
  isSoundEnabled: () => mockIsSoundEnabled,
  setSoundEnabled: (...args: unknown[]) => mockSetSoundEnabled(...args),
}));

const mockPlayHaptic = vi.fn();

vi.mock("../../services/haptics", () => ({
  playHaptic: (...args: unknown[]) => mockPlayHaptic(...args),
}));

vi.mock("../../constants/ui", () => ({
  TOAST_DURATION: 100,
}));

const mockMarkNotificationRead = vi.fn().mockResolvedValue(undefined);
const mockDeleteNotification = vi.fn().mockResolvedValue(undefined);
const mockDeleteUserNotifications = vi.fn().mockResolvedValue(undefined);

vi.mock("../../services/notifications", () => ({
  markNotificationRead: (...args: unknown[]) => mockMarkNotificationRead(...args),
  deleteNotification: (...args: unknown[]) => mockDeleteNotification(...args),
  deleteUserNotifications: (...args: unknown[]) => mockDeleteUserNotifications(...args),
}));

/* ── Helpers ────────────────────────────────── */

function wrapper({ children }: { children: ReactNode }) {
  return <NotificationProvider uid="u1">{children}</NotificationProvider>;
}

function nullUidWrapper({ children }: { children: ReactNode }) {
  return <NotificationProvider uid={null}>{children}</NotificationProvider>;
}

class ErrorCatcher extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <span data-testid="error">{this.state.error.message}</span> : this.props.children;
  }
}

/* ── Tests ──────────────────────────────────── */

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  localStorage.clear();
  mockIsSoundEnabled = true;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useNotifications", () => {
  it("throws when used outside NotificationProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    function TestComponent() {
      useNotifications();
      return null;
    }

    const { getByTestId } = render(
      <ErrorCatcher>
        <TestComponent />
      </ErrorCatcher>,
    );

    expect(getByTestId("error").textContent).toBe("useNotifications must be used within NotificationProvider");
    spy.mockRestore();
  });
});

describe("notify", () => {
  it("adds notification to list and toast queue", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "info", title: "Hello", message: "World" });
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].title).toBe("Hello");
    expect(result.current.notifications[0].message).toBe("World");
    expect(result.current.notifications[0].type).toBe("info");
    expect(result.current.notifications[0].read).toBe(false);
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].id).toBe(result.current.notifications[0].id);
  });

  it("increments notifyKey on each call", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    const initial = result.current.notifyKey;

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "1" });
    });
    expect(result.current.notifyKey).toBe(initial + 1);

    act(() => {
      result.current.notify({ type: "info", title: "B", message: "2" });
    });
    expect(result.current.notifyKey).toBe(initial + 2);
  });

  it("caps toasts at 3", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "1" });
      result.current.notify({ type: "info", title: "B", message: "2" });
      result.current.notify({ type: "info", title: "C", message: "3" });
      result.current.notify({ type: "info", title: "D", message: "4" });
    });

    expect(result.current.toasts).toHaveLength(3);
    // Most recent first
    expect(result.current.toasts[0].title).toBe("D");
  });

  it("plays chime and mapped haptic when opts.chime provided", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "game_event", title: "Turn", message: "Go", chime: "your_turn" });
    });

    expect(mockPlayChime).toHaveBeenCalledWith("your_turn");
    expect(mockPlayHaptic).toHaveBeenCalledWith("your_turn");
  });

  it("plays a toast haptic (no chime) when opts.chime omitted", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "B" });
    });

    expect(mockPlayChime).not.toHaveBeenCalled();
    expect(mockPlayHaptic).toHaveBeenCalledWith("toast");
  });

  it("auto-dismisses toast after TOAST_DURATION", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "B" });
    });
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.toasts).toHaveLength(0);
    // Notification persists in list
    expect(result.current.notifications).toHaveLength(1);
  });

  it("includes gameId when provided", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "game_event", title: "A", message: "B", gameId: "g1" });
    });

    expect(result.current.notifications[0].gameId).toBe("g1");
  });
});

describe("dismissToast", () => {
  it("removes toast from queue", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "B" });
    });
    const id = result.current.toasts[0].id;

    act(() => {
      result.current.dismissToast(id);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it("handles dismissToast with unknown id (no timer to clear)", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    // Dismiss a toast ID that doesn't exist — hits the !timer branch
    act(() => {
      result.current.dismissToast("nonexistent");
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it("clears auto-dismiss timer so no double-remove", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "B" });
    });
    const id = result.current.toasts[0].id;

    act(() => {
      result.current.dismissToast(id);
    });

    // Advancing past TOAST_DURATION should not cause errors
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.toasts).toHaveLength(0);
  });
});

describe("markRead / markAllRead / clearAll", () => {
  it("markRead sets read:true on single notification", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "1" });
      result.current.notify({ type: "info", title: "B", message: "2" });
    });

    const id = result.current.notifications[1].id; // older one

    act(() => {
      result.current.markRead(id);
    });

    expect(result.current.notifications.find((n) => n.id === id)?.read).toBe(true);
    expect(result.current.notifications.find((n) => n.id !== id)?.read).toBe(false);
  });

  it("markRead calls markNotificationRead when firestoreId is present", async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "1", firestoreId: "fs1" });
    });

    const id = result.current.notifications[0].id;

    act(() => {
      result.current.markRead(id);
    });

    // Flush the queueMicrotask scheduled by the updater
    await act(async () => {});

    expect(mockMarkNotificationRead).toHaveBeenCalledWith("fs1");
  });

  it("markRead does not call markNotificationRead without firestoreId", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "1" });
    });

    const id = result.current.notifications[0].id;

    act(() => {
      result.current.markRead(id);
    });

    expect(mockMarkNotificationRead).not.toHaveBeenCalled();
  });

  it("markAllRead sets read:true on all notifications", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "1" });
      result.current.notify({ type: "info", title: "B", message: "2" });
    });

    act(() => {
      result.current.markAllRead();
    });

    expect(result.current.notifications.every((n) => n.read)).toBe(true);
  });

  it("markAllRead calls markNotificationRead for unread notifications with firestoreIds", async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "1", firestoreId: "fs1" });
      result.current.notify({ type: "info", title: "B", message: "2", firestoreId: "fs2" });
      result.current.notify({ type: "info", title: "C", message: "3" }); // no firestoreId
    });

    act(() => {
      result.current.markAllRead();
    });

    // Flush the queueMicrotask scheduled by the updater
    await act(async () => {});

    expect(mockMarkNotificationRead).toHaveBeenCalledTimes(2);
    expect(mockMarkNotificationRead).toHaveBeenCalledWith("fs1");
    expect(mockMarkNotificationRead).toHaveBeenCalledWith("fs2");
  });

  it("clearAll empties notification list", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "1" });
    });

    act(() => {
      result.current.clearAll();
    });

    expect(result.current.notifications).toHaveLength(0);
  });

  it("unreadCount reflects read state changes", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "1" });
      result.current.notify({ type: "info", title: "B", message: "2" });
    });
    expect(result.current.unreadCount).toBe(2);

    act(() => {
      result.current.markRead(result.current.notifications[0].id);
    });
    expect(result.current.unreadCount).toBe(1);

    act(() => {
      result.current.markAllRead();
    });
    expect(result.current.unreadCount).toBe(0);
  });
});

describe("dismissNotification", () => {
  it("uses firestoreId for Firestore delete when present", async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "1", firestoreId: "fs1" });
    });

    const id = result.current.notifications[0].id;

    act(() => {
      result.current.dismissNotification(id);
    });

    // Flush the queueMicrotask scheduled by the updater
    await act(async () => {});

    expect(mockDeleteNotification).toHaveBeenCalledWith("fs1");
    expect(result.current.notifications).toHaveLength(0);
  });

  it("does not call Firestore delete when firestoreId is absent", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "1" });
    });

    const id = result.current.notifications[0].id;

    act(() => {
      result.current.dismissNotification(id);
    });

    expect(mockDeleteNotification).not.toHaveBeenCalled();
    expect(result.current.notifications).toHaveLength(0);
  });
});

describe("clearAll", () => {
  it("calls deleteUserNotifications for the current user", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "1" });
    });

    act(() => {
      result.current.clearAll();
    });

    expect(mockDeleteUserNotifications).toHaveBeenCalledWith("u1");
    expect(result.current.notifications).toHaveLength(0);
  });
});

describe("toggleSound", () => {
  it("toggles soundEnabled and calls setSoundEnabled", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    // Initial: true (from mocked isSoundEnabled)
    expect(result.current.soundEnabled).toBe(true);

    act(() => {
      result.current.toggleSound();
    });
    expect(result.current.soundEnabled).toBe(false);
    expect(mockSetSoundEnabled).toHaveBeenCalledWith(false);

    act(() => {
      result.current.toggleSound();
    });
    expect(result.current.soundEnabled).toBe(true);
    expect(mockSetSoundEnabled).toHaveBeenCalledWith(true);
  });
});

describe("persistence", () => {
  it("loads notifications from localStorage on uid set", () => {
    const stored = [{ id: "n_1", type: "info", title: "Old", message: "msg", timestamp: 1000, read: false }];
    localStorage.setItem("skate_notifs_u1", JSON.stringify(stored));

    const { result } = renderHook(() => useNotifications(), { wrapper });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].title).toBe("Old");
  });

  it("saves notifications to localStorage on change (max 50)", () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      for (let i = 0; i < 55; i++) {
        result.current.notify({ type: "info", title: `N${i}`, message: "m" });
      }
    });

    const saved = JSON.parse(localStorage.getItem("skate_notifs_u1") || "[]");
    expect(saved).toHaveLength(50);
  });

  it("clears notifications when uid becomes null", () => {
    let uid: string | null = "u1";
    const dynamicWrapper = ({ children }: { children: ReactNode }) => (
      <NotificationProvider uid={uid}>{children}</NotificationProvider>
    );

    const { result, rerender } = renderHook(() => useNotifications(), {
      wrapper: dynamicWrapper,
    });

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "B" });
    });
    expect(result.current.notifications).toHaveLength(1);

    // Switch uid to null — triggers the else branch (line 103)
    uid = null;
    rerender();
    expect(result.current.notifications).toHaveLength(0);
  });

  it("handles localStorage.getItem parse error gracefully", () => {
    localStorage.setItem("skate_notifs_u1", "NOT_JSON{{{");

    const { result } = renderHook(() => useNotifications(), { wrapper });

    expect(result.current.notifications).toHaveLength(0);
  });

  it("handles localStorage.setItem quota error gracefully", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded");
    });

    // Should not throw
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "B" });
    });

    // Notifications still work in memory
    expect(result.current.notifications).toHaveLength(1);
    spy.mockRestore();
  });

  it("reloads notifications when uid changes", () => {
    const stored1 = [{ id: "n_1", type: "info", title: "User1", message: "m", timestamp: 1000, read: false }];
    const stored2 = [{ id: "n_2", type: "info", title: "User2", message: "m", timestamp: 2000, read: false }];
    localStorage.setItem("skate_notifs_u1", JSON.stringify(stored1));
    localStorage.setItem("skate_notifs_u2", JSON.stringify(stored2));

    let uid = "u1";
    const { result, rerender } = renderHook(() => useNotifications(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <NotificationProvider uid={uid}>{children}</NotificationProvider>
      ),
    });

    expect(result.current.notifications[0].title).toBe("User1");

    uid = "u2";
    rerender();
    expect(result.current.notifications[0].title).toBe("User2");
  });
});

describe("cleanup", () => {
  it("clears all toast timers on unmount", () => {
    const { result, unmount } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ type: "info", title: "A", message: "1" });
      result.current.notify({ type: "info", title: "B", message: "2" });
    });

    // Unmount should clear timers without errors
    unmount();

    // Advancing timers should not cause errors
    act(() => {
      vi.advanceTimersByTime(200);
    });
  });
});
