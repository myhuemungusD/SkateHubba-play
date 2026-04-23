import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReactInit = vi.fn();
const mockReactCaptureException = vi.fn();
const mockReactCaptureMessage = vi.fn();
const mockReactAddBreadcrumb = vi.fn();
const mockReactSetUser = vi.fn();

const mockCapacitorInit = vi.fn();
const mockCapacitorCaptureException = vi.fn();
const mockCapacitorCaptureMessage = vi.fn();
const mockCapacitorAddBreadcrumb = vi.fn();
const mockCapacitorSetUser = vi.fn();

const mockIsNativePlatform = vi.fn();

vi.mock("@sentry/react", () => ({
  init: mockReactInit,
  captureException: mockReactCaptureException,
  captureMessage: mockReactCaptureMessage,
  addBreadcrumb: mockReactAddBreadcrumb,
  setUser: mockReactSetUser,
}));

vi.mock("@sentry/capacitor", () => ({
  init: mockCapacitorInit,
  captureException: mockCapacitorCaptureException,
  captureMessage: mockCapacitorCaptureMessage,
  addBreadcrumb: mockCapacitorAddBreadcrumb,
  setUser: mockCapacitorSetUser,
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => mockIsNativePlatform(),
  },
}));

beforeEach(() => {
  vi.resetModules();
  mockReactInit.mockReset();
  mockReactCaptureException.mockReset();
  mockReactCaptureMessage.mockReset();
  mockReactAddBreadcrumb.mockReset();
  mockReactSetUser.mockReset();
  mockCapacitorInit.mockReset();
  mockCapacitorCaptureException.mockReset();
  mockCapacitorCaptureMessage.mockReset();
  mockCapacitorAddBreadcrumb.mockReset();
  mockCapacitorSetUser.mockReset();
  mockIsNativePlatform.mockReset();
});

describe("sentry lib", () => {
  describe("web (non-native) platform", () => {
    beforeEach(() => {
      mockIsNativePlatform.mockReturnValue(false);
    });

    it("initSentry loads @sentry/react and calls its init directly", async () => {
      const { initSentry } = await import("../sentry");
      await initSentry({ dsn: "https://test@sentry.io/1" });
      expect(mockReactInit).toHaveBeenCalledWith({ dsn: "https://test@sentry.io/1" });
      expect(mockCapacitorInit).not.toHaveBeenCalled();
    });

    it("captureMessage delegates to the react SDK after init", async () => {
      const { initSentry, captureMessage } = await import("../sentry");
      await initSentry({ dsn: "https://test@sentry.io/1" });
      captureMessage("test message", "error");
      expect(mockReactCaptureMessage).toHaveBeenCalledWith("test message", "error");
      expect(mockCapacitorCaptureMessage).not.toHaveBeenCalled();
    });

    it("captureException delegates to the react SDK after init", async () => {
      const { initSentry, captureException } = await import("../sentry");
      await initSentry({ dsn: "https://test@sentry.io/1" });
      const err = new Error("boom");
      captureException(err, { extra: { ctx: "web" } });
      expect(mockReactCaptureException).toHaveBeenCalledWith(err, { extra: { ctx: "web" } });
      expect(mockCapacitorCaptureException).not.toHaveBeenCalled();
    });

    it("addBreadcrumb delegates to the react SDK after init", async () => {
      const { initSentry, addBreadcrumb } = await import("../sentry");
      await initSentry({ dsn: "https://test@sentry.io/1" });
      addBreadcrumb({ category: "lifecycle", message: "boot" });
      expect(mockReactAddBreadcrumb).toHaveBeenCalledWith({ category: "lifecycle", message: "boot" });
      expect(mockCapacitorAddBreadcrumb).not.toHaveBeenCalled();
    });
  });

  describe("native (Capacitor) platform", () => {
    beforeEach(() => {
      mockIsNativePlatform.mockReturnValue(true);
    });

    it("initSentry uses @sentry/capacitor and passes @sentry/react's init as the sibling", async () => {
      const { initSentry } = await import("../sentry");
      await initSentry({ dsn: "https://test@sentry.io/1" });
      expect(mockCapacitorInit).toHaveBeenCalledTimes(1);
      const [opts, originalInit] = mockCapacitorInit.mock.calls[0];
      expect(opts).toEqual({ dsn: "https://test@sentry.io/1" });
      // The second arg must be @sentry/react's init so the capacitor SDK
      // can bootstrap the JS-layer SDK with the same config.
      expect(originalInit).toBe(mockReactInit);
      // On native, we must not double-init the react SDK directly.
      expect(mockReactInit).not.toHaveBeenCalled();
    });

    it("captureMessage delegates to the capacitor SDK after init", async () => {
      const { initSentry, captureMessage } = await import("../sentry");
      await initSentry({ dsn: "https://test@sentry.io/1" });
      captureMessage("native message", "warning");
      expect(mockCapacitorCaptureMessage).toHaveBeenCalledWith("native message", "warning");
      expect(mockReactCaptureMessage).not.toHaveBeenCalled();
    });

    it("captureException delegates to the capacitor SDK after init", async () => {
      const { initSentry, captureException } = await import("../sentry");
      await initSentry({ dsn: "https://test@sentry.io/1" });
      const err = new Error("native boom");
      captureException(err, { extra: { ctx: "native" } });
      expect(mockCapacitorCaptureException).toHaveBeenCalledWith(err, { extra: { ctx: "native" } });
      expect(mockReactCaptureException).not.toHaveBeenCalled();
    });

    it("addBreadcrumb delegates to the capacitor SDK after init", async () => {
      const { initSentry, addBreadcrumb } = await import("../sentry");
      await initSentry({ dsn: "https://test@sentry.io/1" });
      addBreadcrumb({ category: "lifecycle", message: "native_boot" });
      expect(mockCapacitorAddBreadcrumb).toHaveBeenCalledWith({
        category: "lifecycle",
        message: "native_boot",
      });
      expect(mockReactAddBreadcrumb).not.toHaveBeenCalled();
    });
  });

  describe("before init", () => {
    it("all helpers are safe no-ops if initSentry has not been called", async () => {
      mockIsNativePlatform.mockReturnValue(false);
      const { captureException, captureMessage, addBreadcrumb, setUser } = await import("../sentry");
      // Must not throw and must not touch either SDK.
      expect(() => captureException(new Error("x"))).not.toThrow();
      expect(() => captureMessage("x")).not.toThrow();
      expect(() => addBreadcrumb({ message: "x" })).not.toThrow();
      expect(() => setUser({ id: "u1" })).not.toThrow();
      expect(mockReactCaptureException).not.toHaveBeenCalled();
      expect(mockReactCaptureMessage).not.toHaveBeenCalled();
      expect(mockReactAddBreadcrumb).not.toHaveBeenCalled();
      expect(mockReactSetUser).not.toHaveBeenCalled();
      expect(mockCapacitorCaptureException).not.toHaveBeenCalled();
      expect(mockCapacitorCaptureMessage).not.toHaveBeenCalled();
      expect(mockCapacitorAddBreadcrumb).not.toHaveBeenCalled();
      expect(mockCapacitorSetUser).not.toHaveBeenCalled();
    });
  });
});
