import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NotificationProvider } from "../../context/NotificationContext";
import { ToastContainer } from "../ToastContainer";
import { DeviceCheckRetryToast } from "../DeviceCheckRetryToast";
import { askDeviceCheckRetry, setDeviceCheckPrompt } from "../../services/closetAppCheck";
import { ACTION_TOAST_DURATION } from "../../constants/ui";

vi.mock("../../firebase");
vi.mock("../../services/sounds", () => ({ playChime: vi.fn(), isSoundEnabled: () => false, setSoundEnabled: vi.fn() }));
vi.mock("../../services/haptics", () => ({ playHaptic: vi.fn() }));
vi.mock("../../services/notifications", () => ({
  markNotificationRead: vi.fn(),
  deleteNotification: vi.fn(),
  deleteUserNotifications: vi.fn(),
}));

beforeAll(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
});

function mount() {
  return render(
    <NotificationProvider uid="u1">
      <DeviceCheckRetryToast />
      <ToastContainer />
    </NotificationProvider>,
  );
}

beforeEach(() => {
  setDeviceCheckPrompt(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DeviceCheckRetryToast", () => {
  it("shows the retry toast and answers yes on Retry", async () => {
    mount();
    let answer: Promise<boolean> | undefined;
    act(() => {
      answer = askDeviceCheckRetry();
    });
    expect(screen.getByText("Couldn't verify this device")).toBeInTheDocument();
    expect(screen.getByText("Check your connection and run it back.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await expect(answer).resolves.toBe(true);
  });

  it("answers no when the toast is dismissed", async () => {
    mount();
    let answer: Promise<boolean> | undefined;
    act(() => {
      answer = askDeviceCheckRetry();
    });
    fireEvent.click(screen.getByLabelText("Dismiss notification"));
    await expect(answer).resolves.toBe(false);
  });

  it("answers no when the toast times out", async () => {
    vi.useFakeTimers();
    mount();
    let answer: Promise<boolean> | undefined;
    act(() => {
      answer = askDeviceCheckRetry();
    });
    act(() => {
      vi.advanceTimersByTime(ACTION_TOAST_DURATION);
    });
    await expect(answer).resolves.toBe(false);
  });

  it("unregisters on unmount, so a later failure is not left hanging", async () => {
    const { unmount } = mount();
    unmount();
    await expect(askDeviceCheckRetry()).resolves.toBe(false);
  });
});
