import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock @capacitor/core ─────────────────────── */

const { mockIsNativePlatform, mockGetPlatform } = vi.hoisted(() => ({
  mockIsNativePlatform: vi.fn().mockReturnValue(true),
  mockGetPlatform: vi.fn().mockReturnValue("android"),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => mockIsNativePlatform(),
    getPlatform: () => mockGetPlatform(),
  },
}));

/* ── mock @capacitor/status-bar ───────────────── */

const mockSetStyle = vi.fn();
const mockSetBackgroundColor = vi.fn();
const mockSetOverlaysWebView = vi.fn();

vi.mock("@capacitor/status-bar", () => ({
  StatusBar: {
    setStyle: (...args: unknown[]) => mockSetStyle(...args),
    setBackgroundColor: (...args: unknown[]) => mockSetBackgroundColor(...args),
    setOverlaysWebView: (...args: unknown[]) => mockSetOverlaysWebView(...args),
  },
  Style: { Dark: "DARK", Light: "LIGHT", Default: "DEFAULT" },
}));

/* ── mock @capacitor/app ──────────────────────── */

type BackButtonHandler = (event: { canGoBack: boolean }) => void;

const mockAddListener = vi.fn();
const mockMinimizeApp = vi.fn();
const mockListenerRemove = vi.fn().mockResolvedValue(undefined);

let capturedBackHandler: BackButtonHandler | null = null;

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (event: string, cb: unknown) => mockAddListener(event, cb),
    minimizeApp: (...args: unknown[]) => mockMinimizeApp(...args),
  },
}));

/* ── mock logger ──────────────────────────────── */

const mockWarn = vi.hoisted(() => vi.fn());
vi.mock("../logger", () => ({
  // Full logger surface — the mock replaces the module for every transitive
  // importer (firebase.ts logs at import time), not just nativeApp.ts.
  logger: { warn: mockWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { initStatusBar, subscribeToBackButton } from "../nativeApp";

/** Flush the microtask queue so promise-chained cleanup settles. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  mockIsNativePlatform.mockReturnValue(true);
  mockGetPlatform.mockReturnValue("android");
  mockSetStyle.mockResolvedValue(undefined);
  mockSetBackgroundColor.mockResolvedValue(undefined);
  mockSetOverlaysWebView.mockResolvedValue(undefined);
  mockMinimizeApp.mockResolvedValue(undefined);
  mockListenerRemove.mockResolvedValue(undefined);
  capturedBackHandler = null;
  mockAddListener.mockImplementation((event: string, cb: BackButtonHandler) => {
    if (event === "backButton") capturedBackHandler = cb;
    return Promise.resolve({ remove: mockListenerRemove });
  });
});

describe("initStatusBar", () => {
  it("no-ops on web", async () => {
    mockIsNativePlatform.mockReturnValue(false);
    await initStatusBar();
    expect(mockSetStyle).not.toHaveBeenCalled();
  });

  it("sets dark style + background color + overlay off on Android", async () => {
    await initStatusBar();
    expect(mockSetStyle).toHaveBeenCalledWith({ style: "DARK" });
    expect(mockSetBackgroundColor).toHaveBeenCalledWith({ color: "#0A0A0A" });
    expect(mockSetOverlaysWebView).toHaveBeenCalledWith({ overlay: false });
  });

  it("sets only the style on iOS (background APIs are Android-only)", async () => {
    mockGetPlatform.mockReturnValue("ios");
    await initStatusBar();
    expect(mockSetStyle).toHaveBeenCalledWith({ style: "DARK" });
    expect(mockSetBackgroundColor).not.toHaveBeenCalled();
    expect(mockSetOverlaysWebView).not.toHaveBeenCalled();
  });

  it("swallows plugin failures with a warn log", async () => {
    mockSetStyle.mockRejectedValue(new Error("no bridge"));
    await expect(initStatusBar()).resolves.toBeUndefined();
    expect(mockWarn).toHaveBeenCalledWith("status_bar_init_failed", { error: "no bridge" });
  });
});

describe("subscribeToBackButton", () => {
  it("returns a no-op unsubscribe on web without touching the plugin", () => {
    mockIsNativePlatform.mockReturnValue(false);
    const unsub = subscribeToBackButton();
    expect(mockAddListener).not.toHaveBeenCalled();
    expect(() => unsub()).not.toThrow();
  });

  it("pops SPA history when the WebView can go back", async () => {
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
    subscribeToBackButton();
    await flush();
    expect(capturedBackHandler).not.toBeNull();
    capturedBackHandler!({ canGoBack: true });
    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(mockMinimizeApp).not.toHaveBeenCalled();
    backSpy.mockRestore();
  });

  it("minimizes the app at the history root", async () => {
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
    subscribeToBackButton();
    await flush();
    capturedBackHandler!({ canGoBack: false });
    expect(mockMinimizeApp).toHaveBeenCalledTimes(1);
    expect(backSpy).not.toHaveBeenCalled();
    backSpy.mockRestore();
  });

  it("warns when minimizeApp rejects instead of throwing", async () => {
    mockMinimizeApp.mockRejectedValue(new Error("not supported"));
    subscribeToBackButton();
    await flush();
    capturedBackHandler!({ canGoBack: false });
    await flush();
    expect(mockWarn).toHaveBeenCalledWith("minimize_app_failed", { error: "not supported" });
  });

  it("warns when the listener cannot be attached and unsubscribe stays safe", async () => {
    mockAddListener.mockImplementation(() => Promise.reject(new Error("bridge down")));
    const unsub = subscribeToBackButton();
    await flush();
    expect(mockWarn).toHaveBeenCalledWith("back_button_listener_failed", { error: "bridge down" });
    expect(() => unsub()).not.toThrow();
    await flush();
    expect(mockListenerRemove).not.toHaveBeenCalled();
  });

  it("unsubscribe removes the listener exactly once", async () => {
    const unsub = subscribeToBackButton();
    await flush();
    unsub();
    unsub();
    await flush();
    expect(mockListenerRemove).toHaveBeenCalledTimes(1);
  });

  it("swallows remove() failures during unsubscribe", async () => {
    mockListenerRemove.mockRejectedValue(new Error("already gone"));
    const unsub = subscribeToBackButton();
    await flush();
    expect(() => unsub()).not.toThrow();
    await flush();
    expect(mockListenerRemove).toHaveBeenCalledTimes(1);
  });
});
