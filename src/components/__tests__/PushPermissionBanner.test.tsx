import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PushPermissionBanner } from "../PushPermissionBanner";

const mockRequestPushPermission = vi.fn();

vi.mock("../../services/fcm", () => ({
  requestPushPermission: (...args: unknown[]) => mockRequestPushPermission(...args),
}));

const DISMISSED_KEY = "push_banner_dismissed";

describe("PushPermissionBanner", () => {
  let originalNotification: typeof globalThis.Notification;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    originalNotification = globalThis.Notification;
    // Default: Notification API exists, permission is "default"
    Object.defineProperty(globalThis, "Notification", {
      writable: true,
      configurable: true,
      value: { permission: "default" },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "Notification", {
      writable: true,
      configurable: true,
      value: originalNotification,
    });
  });

  it("renders the banner when permission is default", () => {
    render(<PushPermissionBanner uid="u1" />);
    expect(screen.getByText("Enable push notifications?")).toBeInTheDocument();
    expect(screen.getByText("Enable Notifications")).toBeInTheDocument();
  });

  it("does not render when permission is granted", () => {
    Object.defineProperty(globalThis, "Notification", {
      writable: true,
      configurable: true,
      value: { permission: "granted" },
    });
    const { container } = render(<PushPermissionBanner uid="u1" />);
    expect(container.firstChild).toBeNull();
  });

  it("does not render when permission is denied", () => {
    Object.defineProperty(globalThis, "Notification", {
      writable: true,
      configurable: true,
      value: { permission: "denied" },
    });
    const { container } = render(<PushPermissionBanner uid="u1" />);
    expect(container.firstChild).toBeNull();
  });

  it("does not render when previously dismissed", () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    const { container } = render(<PushPermissionBanner uid="u1" />);
    expect(container.firstChild).toBeNull();
  });

  it("dismisses and sets localStorage on dismiss click", async () => {
    render(<PushPermissionBanner uid="u1" />);
    await userEvent.click(screen.getByLabelText("Dismiss"));
    expect(localStorage.getItem(DISMISSED_KEY)).toBe("1");
    expect(screen.queryByText("Enable push notifications?")).not.toBeInTheDocument();
  });

  it("calls requestPushPermission and hides on success", async () => {
    mockRequestPushPermission.mockResolvedValue("mock-token");

    render(<PushPermissionBanner uid="u1" />);
    await userEvent.click(screen.getByText("Enable Notifications"));

    await waitFor(() => {
      expect(screen.queryByText("Enable push notifications?")).not.toBeInTheDocument();
    });
    expect(mockRequestPushPermission).toHaveBeenCalledWith("u1");
    expect(localStorage.getItem(DISMISSED_KEY)).toBe("1");
  });

  it("shows error when permission is denied", async () => {
    mockRequestPushPermission.mockResolvedValue(null);
    Object.defineProperty(globalThis, "Notification", {
      writable: true,
      configurable: true,
      value: { permission: "default" },
    });

    render(<PushPermissionBanner uid="u1" />);
    await userEvent.click(screen.getByText("Enable Notifications"));

    // After request, simulate permission becoming "denied"
    Object.defineProperty(globalThis, "Notification", {
      writable: true,
      configurable: true,
      value: { permission: "denied" },
    });

    // Re-render to trigger the check - actually the check happens inside the onClick handler
    // We need to set it before the promise resolves
    mockRequestPushPermission.mockImplementation(async () => {
      Object.defineProperty(globalThis, "Notification", {
        writable: true,
        configurable: true,
        value: { permission: "denied" },
      });
      return null;
    });

    // Re-render with fresh state
    const { unmount } = render(<PushPermissionBanner uid="u1" />);
    await userEvent.click(screen.getAllByText("Enable Notifications")[0]);

    await waitFor(() => {
      expect(screen.getByText(/Notifications were blocked/)).toBeInTheDocument();
    });
    unmount();
  });

  it("shows generic error when requestPushPermission throws", async () => {
    mockRequestPushPermission.mockRejectedValue(new Error("network fail"));

    render(<PushPermissionBanner uid="u1" />);
    await userEvent.click(screen.getByText("Enable Notifications"));

    await waitFor(() => {
      expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument();
    });
  });
});
