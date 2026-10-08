import { afterEach, describe, expect, it, vi } from "vitest";
import { GSA_TOOLBAR_FALLBACK_PX, installToolbarOverlay, toolbarOverlayTop } from "../toolbarOverlay";

function iosUa(token: string): string {
  return `Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ${token}`;
}

const SAFARI = iosUa("Version/18.6 Mobile/15E148 Safari/604.1");
const CHROME_IOS = iosUa("CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1");
const GSA = iosUa("Mobile/15E148 GSA/390.0.0 Safari/604.1");
const GSA_IPAD =
  "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 GSA/390.0.0 Safari/604.1";
const GSA_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 GSA/390.0.0";

function env(overrides: Partial<Parameters<typeof toolbarOverlayTop>[0]> = {}) {
  return {
    userAgent: SAFARI,
    nativeShell: false,
    standalone: false,
    atRestOffsetTop: 0,
    ...overrides,
  };
}

describe("toolbarOverlayTop", () => {
  it("stays at 0 for Safari even when the visual viewport reports an offset", () => {
    expect(toolbarOverlayTop(env({ atRestOffsetTop: 59 }))).toBe(0);
  });

  it("stays at 0 for Chrome on iOS", () => {
    expect(toolbarOverlayTop(env({ userAgent: CHROME_IOS, atRestOffsetTop: 80 }))).toBe(0);
  });

  it("stays at 0 for the Android Google app", () => {
    expect(toolbarOverlayTop(env({ userAgent: GSA_ANDROID }))).toBe(0);
  });

  it("stays at 0 in the Capacitor shell and the installed PWA, even if the UA says GSA", () => {
    expect(toolbarOverlayTop(env({ userAgent: GSA, nativeShell: true }))).toBe(0);
    expect(toolbarOverlayTop(env({ userAgent: GSA, standalone: true, atRestOffsetTop: 80 }))).toBe(0);
  });

  it("uses a reported toolbar offset from the Google app instead of the fallback", () => {
    expect(toolbarOverlayTop(env({ userAgent: GSA, atRestOffsetTop: 58.4 }))).toBe(58);
    expect(toolbarOverlayTop(env({ userAgent: GSA_IPAD, atRestOffsetTop: 72 }))).toBe(72);
  });

  it("falls back when the Google app reports no toolbar offset", () => {
    expect(toolbarOverlayTop(env({ userAgent: GSA, atRestOffsetTop: 0 }))).toBe(GSA_TOOLBAR_FALLBACK_PX);
    expect(toolbarOverlayTop(env({ userAgent: GSA, atRestOffsetTop: 2 }))).toBe(GSA_TOOLBAR_FALLBACK_PX);
    expect(toolbarOverlayTop(env({ userAgent: GSA, atRestOffsetTop: Number.NaN }))).toBe(GSA_TOOLBAR_FALLBACK_PX);
    expect(toolbarOverlayTop(env({ userAgent: GSA, atRestOffsetTop: -10 }))).toBe(GSA_TOOLBAR_FALLBACK_PX);
  });
});

describe("installToolbarOverlay", () => {
  const originalUA = navigator.userAgent;
  let restore: (() => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: originalUA });
    document.documentElement.style.removeProperty("--overlay-top");
    vi.unstubAllGlobals();
  });

  function setUA(ua: string): void {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: ua });
  }

  it("publishes the fallback for the Google app and clears it on teardown", () => {
    setUA(GSA);
    restore = installToolbarOverlay(window, () => false);
    expect(document.documentElement.style.getPropertyValue("--overlay-top")).toBe(`${GSA_TOOLBAR_FALLBACK_PX}px`);
    restore();
    restore = null;
    expect(document.documentElement.style.getPropertyValue("--overlay-top")).toBe("");
  });

  it("publishes a reported offset sampled at rest and keeps it after scrolling", () => {
    setUA(GSA);
    let scrollY = 0;
    let offsetTop = 80;
    const listeners = new Map<string, () => void>();
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
    vi.stubGlobal("visualViewport", {
      get offsetTop() {
        return offsetTop;
      },
      addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
      removeEventListener: vi.fn(),
    });

    restore = installToolbarOverlay(window, () => false);
    expect(document.documentElement.style.getPropertyValue("--overlay-top")).toBe("80px");

    scrollY = 200;
    offsetTop = 0;
    listeners.get("scroll")?.();
    expect(document.documentElement.style.getPropertyValue("--overlay-top")).toBe("80px");

    scrollY = 0;
    offsetTop = 0;
    listeners.get("resize")?.();
    expect(document.documentElement.style.getPropertyValue("--overlay-top")).toBe(`${GSA_TOOLBAR_FALLBACK_PX}px`);
  });

  it("publishes nothing for Safari, including when the page is standalone or native", () => {
    setUA(SAFARI);
    const vv = {
      offsetTop: 40,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("visualViewport", vv);
    restore = installToolbarOverlay(window, () => false);
    expect(document.documentElement.style.getPropertyValue("--overlay-top")).toBe("");

    restore();
    setUA(GSA);
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    restore = installToolbarOverlay(window, () => false);
    expect(document.documentElement.style.getPropertyValue("--overlay-top")).toBe("");

    restore();
    restore = installToolbarOverlay(window, () => true);
    expect(document.documentElement.style.getPropertyValue("--overlay-top")).toBe("");
    Reflect.deleteProperty(navigator, "standalone");
  });

  it("treats a broken matchMedia as not standalone and still pads the Google app", () => {
    setUA(GSA);
    const original = window.matchMedia;
    window.matchMedia = () => {
      throw new Error("no media");
    };
    restore = installToolbarOverlay(window, () => false);
    expect(document.documentElement.style.getPropertyValue("--overlay-top")).toBe(`${GSA_TOOLBAR_FALLBACK_PX}px`);
    window.matchMedia = original;
  });

  it("republishes on orientation change", () => {
    setUA(CHROME_IOS);
    restore = installToolbarOverlay(window, () => false);
    expect(document.documentElement.style.getPropertyValue("--overlay-top")).toBe("");
    setUA(GSA);
    window.dispatchEvent(new Event("orientationchange"));
    expect(document.documentElement.style.getPropertyValue("--overlay-top")).toBe(`${GSA_TOOLBAR_FALLBACK_PX}px`);
  });
});
