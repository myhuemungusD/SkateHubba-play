import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockIsNativePlatform = vi.fn(() => false);
vi.mock("../../services/nativeVideo", () => ({
  isNativePlatform: () => mockIsNativePlatform(),
}));

vi.mock("../../services/analytics", () => ({
  analytics: { installPromptAnswered: vi.fn(), appInstalled: vi.fn() },
}));

import { useInstallPrompt, isIosDevice, isStandaloneDisplay, resolveInstallStatus } from "../useInstallPrompt";
import {
  captureInstallPrompt,
  promptInstall,
  __resetInstallPromptForTest,
  type BeforeInstallPromptEvent,
} from "../../lib/installPrompt";

const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";

function setNavigator(overrides: { userAgent?: string; maxTouchPoints?: number; standalone?: boolean | undefined }) {
  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(navigator, key, { value, writable: true, configurable: true });
  }
}

function setMatchMedia(matches: boolean | undefined) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matches === undefined ? undefined : vi.fn(() => ({ matches })),
  });
}

function fireBeforeInstallPrompt(outcome: "accepted" | "dismissed") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as BeforeInstallPromptEvent;
  Object.assign(event, {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome, platform: "web" }),
  });
  window.dispatchEvent(event);
}

describe("useInstallPrompt", () => {
  beforeEach(() => {
    __resetInstallPromptForTest();
    captureInstallPrompt();
    mockIsNativePlatform.mockReturnValue(false);
    setNavigator({ userAgent: DESKTOP_UA, maxTouchPoints: 0, standalone: undefined });
    setMatchMedia(false);
  });

  afterEach(() => {
    __resetInstallPromptForTest();
    setMatchMedia(undefined);
    vi.clearAllMocks();
  });

  describe("isStandaloneDisplay", () => {
    it("is true for an iOS home-screen app (navigator.standalone)", () => {
      setNavigator({ standalone: true });
      expect(isStandaloneDisplay()).toBe(true);
    });

    it("is true when the display-mode media query matches", () => {
      setMatchMedia(true);
      expect(isStandaloneDisplay()).toBe(true);
    });

    it("is false in a plain browser tab", () => {
      expect(isStandaloneDisplay()).toBe(false);
    });

    it("is false when matchMedia is unavailable", () => {
      setMatchMedia(undefined);
      expect(isStandaloneDisplay()).toBe(false);
    });
  });

  describe("isIosDevice", () => {
    it("detects iPhone user agents", () => {
      setNavigator({ userAgent: IPHONE_UA });
      expect(isIosDevice()).toBe(true);
    });

    it("detects iPadOS behind a desktop-Mac user agent via touch points", () => {
      setNavigator({ userAgent: MAC_UA, maxTouchPoints: 5 });
      expect(isIosDevice()).toBe(true);
    });

    it("does not flag a real Mac", () => {
      setNavigator({ userAgent: MAC_UA, maxTouchPoints: 0 });
      expect(isIosDevice()).toBe(false);
    });

    it("does not flag desktop Windows", () => {
      expect(isIosDevice()).toBe(false);
    });
  });

  describe("resolveInstallStatus", () => {
    it("is native inside the Capacitor shell regardless of the store", () => {
      mockIsNativePlatform.mockReturnValue(true);
      expect(resolveInstallStatus("prompt")).toBe("native");
    });

    it("is installed when the store says so", () => {
      expect(resolveInstallStatus("installed")).toBe("installed");
    });

    it("is installed when already running standalone", () => {
      setMatchMedia(true);
      expect(resolveInstallStatus("none")).toBe("installed");
    });

    it("is prompt when Chromium parked the event", () => {
      expect(resolveInstallStatus("prompt")).toBe("prompt");
    });

    it("is ios on an iPhone with no prompt", () => {
      setNavigator({ userAgent: IPHONE_UA });
      expect(resolveInstallStatus("none")).toBe("ios");
    });

    it("falls back to manual everywhere else", () => {
      expect(resolveInstallStatus("none")).toBe("manual");
    });
  });

  it("starts manual and flips to prompt when beforeinstallprompt fires", () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.status).toBe("manual");
    act(() => fireBeforeInstallPrompt("accepted"));
    expect(result.current.status).toBe("prompt");
    expect(result.current.promptInstall).toBe(promptInstall);
  });

  it("flips to installed after the user accepts the dialog", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => fireBeforeInstallPrompt("accepted"));
    await act(async () => {
      await expect(result.current.promptInstall()).resolves.toBe("accepted");
    });
    expect(result.current.status).toBe("installed");
  });

  it("drops back to manual after the user dismisses the dialog", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => fireBeforeInstallPrompt("dismissed"));
    await act(async () => {
      await expect(result.current.promptInstall()).resolves.toBe("dismissed");
    });
    expect(result.current.status).toBe("manual");
  });

  it("flips to installed on appinstalled", () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(result.current.status).toBe("installed");
  });
});
