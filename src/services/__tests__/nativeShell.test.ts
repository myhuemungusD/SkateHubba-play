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
vi.mock("@capacitor/status-bar", () => ({
  StatusBar: {
    setStyle: (...args: unknown[]) => mockSetStyle(...args),
    setBackgroundColor: (...args: unknown[]) => mockSetBackgroundColor(...args),
  },
  Style: { Dark: "DARK", Light: "LIGHT", Default: "DEFAULT" },
}));

/* ── mock @capacitor/app ──────────────────────── */

const mockAddListener = vi.fn();
const mockExitApp = vi.fn();
const mockListenerRemove = vi.fn().mockResolvedValue(undefined);
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (event: string, cb: unknown) => mockAddListener(event, cb),
    exitApp: (...args: unknown[]) => mockExitApp(...args),
  },
}));

const mockWarn = vi.hoisted(() => vi.fn());
vi.mock("../logger", () => ({ logger: { warn: mockWarn, info: vi.fn(), debug: vi.fn() } }));

/* ── tests ───────────────────────────────────── */

import {
  isNativeShell,
  initStatusBar,
  subscribeToBackButton,
  subscribeToDeepLinks,
  deepLinkPath,
  exitNativeApp,
} from "../nativeShell";

async function flush(): Promise<void> {
  // A macrotask tick — the dynamic `import("@capacitor/app")` inside the
  // subscribe helpers resolves over several microtasks before addListener
  // is even called, so a handful of `await Promise.resolve()` isn't enough.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsNativePlatform.mockReturnValue(true);
  mockGetPlatform.mockReturnValue("android");
  mockSetStyle.mockResolvedValue(undefined);
  mockSetBackgroundColor.mockResolvedValue(undefined);
  mockExitApp.mockResolvedValue(undefined);
  mockListenerRemove.mockResolvedValue(undefined);
  mockAddListener.mockImplementation(async () => ({ remove: mockListenerRemove }));
});

describe("isNativeShell", () => {
  it("mirrors Capacitor.isNativePlatform", () => {
    expect(isNativeShell()).toBe(true);
    mockIsNativePlatform.mockReturnValue(false);
    expect(isNativeShell()).toBe(false);
  });
});

describe("initStatusBar", () => {
  it("sets light content and the dark background on Android", async () => {
    await initStatusBar();
    expect(mockSetStyle).toHaveBeenCalledWith({ style: "DARK" });
    expect(mockSetBackgroundColor).toHaveBeenCalledWith({ color: "#0A0A0A" });
  });

  it("skips setBackgroundColor on iOS (unsupported there)", async () => {
    mockGetPlatform.mockReturnValue("ios");
    await initStatusBar();
    expect(mockSetStyle).toHaveBeenCalledWith({ style: "DARK" });
    expect(mockSetBackgroundColor).not.toHaveBeenCalled();
  });

  it("no-ops on web without touching the plugin", async () => {
    mockIsNativePlatform.mockReturnValue(false);
    await initStatusBar();
    expect(mockSetStyle).not.toHaveBeenCalled();
  });

  it("swallows plugin failures so startup is never blocked", async () => {
    mockSetStyle.mockRejectedValueOnce(new Error("no status bar"));
    await expect(initStatusBar()).resolves.toBeUndefined();
    expect(mockWarn).toHaveBeenCalledWith("status_bar_init_failed", expect.anything());
  });
});

describe("subscribeToBackButton", () => {
  type BackHandler = (event: { canGoBack?: boolean }) => void;

  async function subscribe(cb: (e: { canGoBack: boolean }) => void): Promise<{
    fire: BackHandler;
    unsub: () => void;
  }> {
    let handler: BackHandler = () => {};
    mockAddListener.mockImplementation(async (event: string, listener: unknown) => {
      if (event === "backButton") handler = listener as BackHandler;
      return { remove: mockListenerRemove };
    });
    const unsub = subscribeToBackButton(cb);
    await flush();
    return { fire: (e) => handler(e), unsub };
  }

  it("forwards canGoBack from the plugin event", async () => {
    const cb = vi.fn();
    const { fire } = await subscribe(cb);
    fire({ canGoBack: true });
    expect(cb).toHaveBeenCalledWith({ canGoBack: true });
  });

  it("normalises a missing canGoBack to false", async () => {
    const cb = vi.fn();
    const { fire } = await subscribe(cb);
    fire({});
    expect(cb).toHaveBeenCalledWith({ canGoBack: false });
  });

  it("is idempotent — a double unsubscribe still detaches exactly one listener", async () => {
    const { unsub } = await subscribe(vi.fn());
    for (const _ of [1, 2, 3]) unsub();
    await flush();
    expect(mockListenerRemove).toHaveBeenCalledOnce();
  });

  it("returns a no-op unsubscribe on web", () => {
    mockIsNativePlatform.mockReturnValue(false);
    const unsub = subscribeToBackButton(vi.fn());
    unsub();
    expect(mockAddListener).not.toHaveBeenCalled();
  });

  it("survives a plugin that rejects addListener", async () => {
    mockAddListener.mockRejectedValueOnce(new Error("no listener for you"));
    const unsub = subscribeToBackButton(vi.fn());
    await flush();
    expect(mockWarn).toHaveBeenCalledWith("native_app_listener_failed", expect.anything());
    expect(() => unsub()).not.toThrow();
    await flush();
    expect(mockListenerRemove).not.toHaveBeenCalled();
  });
});

describe("deepLinkPath", () => {
  it("returns path + query + hash for an https universal link", () => {
    expect(deepLinkPath("https://skatehubba.com/game/xyz")).toBe("/game/xyz");
    expect(deepLinkPath("https://skatehubba.com/challenge?spot=abc#top")).toBe("/challenge?spot=abc#top");
    expect(deepLinkPath("http://skatehubba.com/lobby")).toBe("/lobby");
  });

  it("returns null for the bare origin — there is nothing to navigate to", () => {
    expect(deepLinkPath("https://skatehubba.com/")).toBeNull();
  });

  it("returns null for non-http schemes and malformed URLs", () => {
    expect(deepLinkPath("com.skatehubba.app://game/xyz")).toBeNull();
    expect(deepLinkPath("not a url")).toBeNull();
  });
});

describe("subscribeToDeepLinks", () => {
  type UrlHandler = (event: { url: unknown }) => void;

  async function subscribe(cb: (path: string) => void): Promise<{ fire: UrlHandler; unsub: () => void }> {
    let handler: UrlHandler = () => {};
    mockAddListener.mockImplementation(async (event: string, listener: unknown) => {
      if (event === "appUrlOpen") handler = listener as UrlHandler;
      return { remove: mockListenerRemove };
    });
    const unsub = subscribeToDeepLinks(cb);
    await flush();
    return { fire: (e) => handler(e), unsub };
  }

  it("emits the in-app path for an https deep link", async () => {
    const cb = vi.fn();
    const { fire } = await subscribe(cb);
    fire({ url: "https://skatehubba.com/game/xyz" });
    expect(cb).toHaveBeenCalledWith("/game/xyz");
  });

  it("stays silent for unusable payloads", async () => {
    const cb = vi.fn();
    const { fire } = await subscribe(cb);
    fire({ url: "https://skatehubba.com/" });
    fire({ url: 42 });
    expect(cb).not.toHaveBeenCalled();
  });

  it("detaches the listener on unsubscribe", async () => {
    const { unsub } = await subscribe(vi.fn());
    unsub();
    await flush();
    expect(mockListenerRemove).toHaveBeenCalledOnce();
  });

  it("swallows a remove() rejection so unmount never throws", async () => {
    mockListenerRemove.mockRejectedValueOnce(new Error("remove failed"));
    const { unsub } = await subscribe(vi.fn());
    expect(() => unsub()).not.toThrow();
    await flush();
  });

  it("returns a no-op unsubscribe on web", () => {
    mockIsNativePlatform.mockReturnValue(false);
    const unsub = subscribeToDeepLinks(vi.fn());
    unsub();
    expect(mockAddListener).not.toHaveBeenCalled();
  });
});

describe("exitNativeApp", () => {
  it("calls the plugin on native", async () => {
    await exitNativeApp();
    expect(mockExitApp).toHaveBeenCalledOnce();
  });

  it("no-ops on web", async () => {
    mockIsNativePlatform.mockReturnValue(false);
    await exitNativeApp();
    expect(mockExitApp).not.toHaveBeenCalled();
  });

  it("swallows a plugin failure", async () => {
    mockExitApp.mockRejectedValueOnce(new Error("cannot exit"));
    await expect(exitNativeApp()).resolves.toBeUndefined();
    expect(mockWarn).toHaveBeenCalledWith("native_app_exit_failed", expect.anything());
  });
});
