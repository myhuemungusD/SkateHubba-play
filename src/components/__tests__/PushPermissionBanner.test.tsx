import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PushPermissionBanner } from "../PushPermissionBanner";

const mockRequestPushPermission = vi.fn();

vi.mock("../../services/fcm", () => ({
  requestPushPermission: (...args: unknown[]) => mockRequestPushPermission(...args),
}));

// Native (Capacitor) push service. Defaults to "not a native shell" so every
// existing web assertion below exercises the unchanged fcm path.
const mockIsPushSupported = vi.fn(() => false);
const mockGetNativePermission = vi.fn();
const mockRequestNativePermission = vi.fn();
const mockRegisterPushToken = vi.fn();

vi.mock("../../services/pushNotifications", () => ({
  isPushSupported: () => mockIsPushSupported(),
  getNativePushPermission: () => mockGetNativePermission(),
  requestPushPermission: (...args: unknown[]) => mockRequestNativePermission(...args),
  registerPushToken: (...args: unknown[]) => mockRegisterPushToken(...args),
}));

const DISMISSED_KEY = "push_banner_dismissed";

describe("PushPermissionBanner", () => {
  let originalNotification: typeof globalThis.Notification;

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks wipes call history but not return values — re-arm the
    // web defaults explicitly so a native test can't leak into the next one.
    mockIsPushSupported.mockReturnValue(false);
    mockGetNativePermission.mockResolvedValue("prompt");
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

  /* ── Native (Capacitor) ─────────────────────────────── */

  describe("on a native shell", () => {
    beforeEach(() => {
      mockIsPushSupported.mockReturnValue(true);
      // A native WebView still exposes Notification, and its permission is
      // unrelated to the OS grant — "denied" here must not hide the banner.
      Object.defineProperty(globalThis, "Notification", {
        writable: true,
        configurable: true,
        value: { permission: "denied" },
      });
    });

    /** Render and wait for the async permission read to reveal the banner. */
    async function renderRevealed() {
      render(<PushPermissionBanner uid="u1" />);
      await screen.findByText("Enable push notifications?");
    }

    it("renders once the plugin reports permission is still prompt-able", async () => {
      await renderRevealed();
      expect(screen.getByText("Enable Notifications")).toBeInTheDocument();
    });

    it.each([
      ["granted", "already allowed push"],
      ["denied", "already refused push"],
    ])("stays hidden when the device has %s", async (permission) => {
      mockGetNativePermission.mockResolvedValue(permission);
      render(<PushPermissionBanner uid="u1" />);
      await waitFor(() => expect(mockGetNativePermission).toHaveBeenCalled());
      expect(screen.queryByText("Enable push notifications?")).not.toBeInTheDocument();
    });

    it("still honours a previous dismissal without querying permission", async () => {
      localStorage.setItem(DISMISSED_KEY, "1");
      const { container } = render(<PushPermissionBanner uid="u1" />);
      await waitFor(() => expect(container.firstChild).toBeNull());
      expect(mockGetNativePermission).not.toHaveBeenCalled();
    });

    it("prompts through the native plugin and registers the token on grant", async () => {
      mockRequestNativePermission.mockResolvedValue("granted");
      mockRegisterPushToken.mockResolvedValue(undefined);

      await renderRevealed();
      await userEvent.click(screen.getByText("Enable Notifications"));

      await waitFor(() => {
        expect(screen.queryByText("Enable push notifications?")).not.toBeInTheDocument();
      });
      expect(mockRequestNativePermission).toHaveBeenCalled();
      // assumeEnabled: explicit gesture, so the pref re-read is skipped.
      expect(mockRegisterPushToken).toHaveBeenCalledWith("u1", { assumeEnabled: true });
      // The web pair must never run inside a native shell — it bails out
      // without a service worker and would leave the user unregistered.
      expect(mockRequestPushPermission).not.toHaveBeenCalled();
      expect(localStorage.getItem(DISMISSED_KEY)).toBe("1");
    });

    it.each([
      ["denied", /Notifications were blocked. Enable them in your device settings/],
      ["prompt", /Could not enable notifications. Please try again./],
    ])("explains a %s outcome without registering", async (permission, message) => {
      mockRequestNativePermission.mockResolvedValue(permission);

      await renderRevealed();
      await userEvent.click(screen.getByText("Enable Notifications"));

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(mockRegisterPushToken).not.toHaveBeenCalled();
    });

    it("shows the generic error when the native prompt throws", async () => {
      mockRequestNativePermission.mockRejectedValue(new Error("plugin unavailable"));

      await renderRevealed();
      await userEvent.click(screen.getByText("Enable Notifications"));

      expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
    });
  });
});
