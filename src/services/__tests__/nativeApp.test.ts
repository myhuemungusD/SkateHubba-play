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
type UrlOpenHandler = (event: { url: string }) => void;

const mockAddListener = vi.fn();
const mockMinimizeApp = vi.fn();
const mockListenerRemove = vi.fn().mockResolvedValue(undefined);

let capturedBackHandler: BackButtonHandler | null = null;
let capturedUrlHandler: UrlOpenHandler | null = null;

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

import { initStatusBar, subscribeToBackButton, subscribeToDeepLinks } from "../nativeApp";

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
  capturedUrlHandler = null;
  mockAddListener.mockImplementation((event: string, cb: BackButtonHandler & UrlOpenHandler) => {
    if (event === "backButton") capturedBackHandler = cb;
    if (event === "appUrlOpen") capturedUrlHandler = cb;
    return Promise.resolve({ remove: mockListenerRemove });
  });
});

/**
 * Unsubscribe-lifecycle assertions shared by both subscribe* exports: the
 * handle is removed exactly once no matter how often unsubscribe is called,
 * and a rejecting `remove()` never throws at the caller.
 */
async function expectIdempotentUnsubscribe(subscribe: () => () => void): Promise<void> {
  const unsub = subscribe();
  await flush();
  expect(() => {
    unsub();
    unsub();
  }).not.toThrow();
  await flush();
  expect(mockListenerRemove).toHaveBeenCalledTimes(1);
}

/** Subscribe, wait for the listener handle, and fire one appUrlOpen. */
async function openUrl(url: string): Promise<string[]> {
  const paths: string[] = [];
  subscribeToDeepLinks((p) => paths.push(p));
  await flush();
  capturedUrlHandler!({ url });
  return paths;
}

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
    await expectIdempotentUnsubscribe(subscribeToBackButton);
  });

  it("swallows remove() failures during unsubscribe", async () => {
    mockListenerRemove.mockRejectedValue(new Error("already gone"));
    await expectIdempotentUnsubscribe(subscribeToBackButton);
  });
});

describe("subscribeToDeepLinks", () => {
  it("returns a no-op unsubscribe on web without touching the plugin", () => {
    mockIsNativePlatform.mockReturnValue(false);
    const unsub = subscribeToDeepLinks(vi.fn());
    expect(mockAddListener).not.toHaveBeenCalled();
    expect(() => unsub()).not.toThrow();
  });

  it("hands the caller the path of a claimed https link", async () => {
    expect(await openUrl("https://skatehubba.com/player/abc123")).toEqual(["/player/abc123"]);
  });

  it("preserves the query string and hash", async () => {
    expect(await openUrl("https://skatehubba.com/feed?tab=hot#clip1")).toEqual(["/feed?tab=hot#clip1"]);
  });

  it("accepts the www host (redirected on web, matched by the OS first)", async () => {
    expect(await openUrl("https://www.skatehubba.com/lobby")).toEqual(["/lobby"]);
  });

  it("ignores a bare-origin link with no destination", async () => {
    expect(await openUrl("https://skatehubba.com/")).toEqual([]);
  });

  it("ignores non-http(s) schemes such as OAuth callbacks", async () => {
    expect(await openUrl("com.skatehubba.app://oauth/callback")).toEqual([]);
  });

  it("ignores foreign hosts", async () => {
    expect(await openUrl("https://evil.example.com/game/1")).toEqual([]);
  });

  it("warns and ignores an unparseable url", async () => {
    expect(await openUrl("not a url")).toEqual([]);
    expect(mockWarn).toHaveBeenCalledWith("deep_link_unparseable");
  });

  it("warns when the listener cannot be attached and unsubscribe stays safe", async () => {
    mockAddListener.mockImplementation(() => Promise.reject(new Error("bridge down")));
    const unsub = subscribeToDeepLinks(vi.fn());
    await flush();
    expect(mockWarn).toHaveBeenCalledWith("deep_link_listener_failed", { error: "bridge down" });
    expect(() => unsub()).not.toThrow();
    await flush();
    expect(mockListenerRemove).not.toHaveBeenCalled();
  });

  it("unsubscribe removes the listener exactly once", async () => {
    await expectIdempotentUnsubscribe(() => subscribeToDeepLinks(vi.fn()));
  });

  it("swallows remove() failures during unsubscribe", async () => {
    mockListenerRemove.mockRejectedValue(new Error("already gone"));
    await expectIdempotentUnsubscribe(() => subscribeToDeepLinks(vi.fn()));
  });
});
