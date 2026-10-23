import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { firebaseSwitchDefaults } from "./closetFirebase.test-helpers";

const h = vi.hoisted(() => ({
  env: {
    VITE_APPCHECK_ENABLED: false,
    VITE_APPCHECK_WEB_MODE: "lazy",
    VITE_RECAPTCHA_SITE_KEY: "site-key" as string | undefined,
  } as Record<string, unknown> | null,
  native: vi.fn(() => false),
  initializeAppCheck: vi.fn(),
  ReCaptchaV3Provider: vi.fn(function (this: { key: string }, key: string) {
    this.key = key;
  }),
  appCheckImported: vi.fn(),
  captureMessage: vi.fn(),
}));

const fb = vi.hoisted(() => ({ app: {} as unknown, emulator: false }));
vi.mock("../../firebase", async () => (await import("./closetFirebase.test-helpers")).switchableFirebaseMock(fb));
vi.mock("../../lib/env", () => ({
  get env() {
    return h.env;
  },
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => h.native(), getPlatform: () => "web" } }));
vi.mock("../../lib/sentry", () => ({ captureMessage: h.captureMessage, addBreadcrumb: vi.fn() }));
vi.mock("firebase/app-check", () => {
  h.appCheckImported();
  return { initializeAppCheck: h.initializeAppCheck, ReCaptchaV3Provider: h.ReCaptchaV3Provider };
});

type Mod = typeof import("../closetAppCheck");

async function load(): Promise<Mod> {
  vi.resetModules();
  return import("../closetAppCheck");
}

function recaptchaScripts(): HTMLScriptElement[] {
  return Array.from(document.head.querySelectorAll<HTMLScriptElement>("script")).filter((s) =>
    s.src.includes("recaptcha"),
  );
}

/** Fire load on the pending reCAPTCHA script, defining grecaptcha first unless told not to. */
function finishScript(kind: "load" | "error" | "load-empty"): void {
  const [script] = recaptchaScripts();
  if (!script) throw new Error("no recaptcha script");
  if (kind === "error") {
    script.onerror?.(new Event("error"));
    return;
  }
  if (kind === "load") (window as unknown as Record<string, unknown>).grecaptcha = { ready: vi.fn() };
  script.onload?.(new Event("load"));
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(fb, firebaseSwitchDefaults());
  h.env = { VITE_APPCHECK_ENABLED: false, VITE_APPCHECK_WEB_MODE: "lazy", VITE_RECAPTCHA_SITE_KEY: "site-key" };
  h.native.mockReturnValue(false);
  delete (window as unknown as Record<string, unknown>).grecaptcha;
  delete (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN;
  recaptchaScripts().forEach((s) => s.remove());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usesLazyWebAppCheck", () => {
  it("is on for web with the sitewide switch off and the default lazy mode", async () => {
    const m = await load();
    expect(m.usesLazyWebAppCheck()).toBe(true);
  });

  it("is off when the sitewide switch is on, the mode is off, on native, or with no env", async () => {
    let m = await load();
    h.env = { ...h.env, VITE_APPCHECK_ENABLED: true };
    expect(m.usesLazyWebAppCheck()).toBe(false);
    h.env = { ...h.env, VITE_APPCHECK_ENABLED: false, VITE_APPCHECK_WEB_MODE: "off" };
    expect(m.usesLazyWebAppCheck()).toBe(false);
    h.env = { ...h.env, VITE_APPCHECK_WEB_MODE: "lazy" };
    h.native.mockReturnValue(true);
    expect(m.usesLazyWebAppCheck()).toBe(false);
    h.env = null;
    m = await load();
    expect(m.usesLazyWebAppCheck()).toBe(false);
  });
});

describe("ensureClosetAppCheck", () => {
  it("defers to the sitewide/native path when lazy mode does not apply", async () => {
    h.env = { ...h.env, VITE_APPCHECK_ENABLED: true };
    const m = await load();
    const firebase = await import("../../firebase");
    await m.ensureClosetAppCheck();
    expect(firebase.ensureAppCheck).toHaveBeenCalled();
    expect(h.appCheckImported).not.toHaveBeenCalled();
    expect(recaptchaScripts()).toHaveLength(0);
  });

  it("does nothing at import: no script, no app-check module", async () => {
    await load();
    expect(recaptchaScripts()).toHaveLength(0);
    expect(h.appCheckImported).not.toHaveBeenCalled();
  });

  it("loads reCAPTCHA and initializes App Check once, with no background refresh", async () => {
    const m = await load();
    const first = m.ensureClosetAppCheck();
    const second = m.ensureClosetAppCheck();
    expect(recaptchaScripts()).toHaveLength(1);
    expect(recaptchaScripts()[0].src).toBe(m.RECAPTCHA_V3_URL);
    finishScript("load");
    await Promise.all([first, second]);
    await m.ensureClosetAppCheck();
    expect(h.initializeAppCheck).toHaveBeenCalledTimes(1);
    expect(h.ReCaptchaV3Provider).toHaveBeenCalledWith("site-key");
    expect(h.initializeAppCheck).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isTokenAutoRefreshEnabled: false }),
    );
    expect(recaptchaScripts()).toHaveLength(1);
  });

  it("reuses a reCAPTCHA that is already on the page", async () => {
    (window as unknown as Record<string, unknown>).grecaptcha = { ready: vi.fn() };
    const m = await load();
    await m.ensureClosetAppCheck();
    expect(recaptchaScripts()).toHaveLength(0);
    expect(h.initializeAppCheck).toHaveBeenCalledTimes(1);
  });

  it("sets the debug token only in emulator mode", async () => {
    fb.emulator = true;
    (window as unknown as Record<string, unknown>).grecaptcha = {};
    const m = await load();
    await m.ensureClosetAppCheck();
    expect((self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true);
  });

  it("throws when Firebase never initialized", async () => {
    fb.app = null;
    const m = await load();
    await expect(m.ensureClosetAppCheck()).rejects.toThrow("Firebase not initialized");
  });

  it("fails as a device check, and reports it, when the site key is missing", async () => {
    h.env = { ...h.env, VITE_RECAPTCHA_SITE_KEY: undefined };
    const m = await load();
    await expect(m.ensureClosetAppCheck()).rejects.toBeInstanceOf(m.DeviceCheckError);
    expect(h.captureMessage).toHaveBeenCalledWith(expect.stringContaining("VITE_RECAPTCHA_SITE_KEY"), "error");
    expect(recaptchaScripts()).toHaveLength(0);
  });

  it("fails when the script errors, removes it, and loads it again on the next try", async () => {
    const m = await load();
    const first = m.ensureClosetAppCheck();
    finishScript("error");
    await expect(first).rejects.toBeInstanceOf(m.DeviceCheckError);
    expect(recaptchaScripts()).toHaveLength(0);
    expect(h.initializeAppCheck).not.toHaveBeenCalled();

    const second = m.ensureClosetAppCheck();
    expect(recaptchaScripts()).toHaveLength(1);
    finishScript("load");
    await expect(second).resolves.toBeUndefined();
    expect(h.initializeAppCheck).toHaveBeenCalledTimes(1);
  });

  it("fails when the script loads but grecaptcha never shows up", async () => {
    const m = await load();
    const p = m.ensureClosetAppCheck();
    finishScript("load-empty");
    await expect(p).rejects.toBeInstanceOf(m.DeviceCheckError);
    expect(recaptchaScripts()).toHaveLength(0);
  });

  it("fails after the timeout when the script never answers", async () => {
    vi.useFakeTimers();
    const m = await load();
    const p = m.ensureClosetAppCheck();
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(m.RECAPTCHA_LOAD_TIMEOUT_MS);
    expect(await caught).toBeInstanceOf(m.DeviceCheckError);
    expect(recaptchaScripts()).toHaveLength(0);
  });

  it("fails as a device check when initializeAppCheck throws", async () => {
    h.initializeAppCheck.mockImplementationOnce(() => {
      throw new Error("bad key");
    });
    (window as unknown as Record<string, unknown>).grecaptcha = {};
    const m = await load();
    await expect(m.ensureClosetAppCheck()).rejects.toBeInstanceOf(m.DeviceCheckError);
    h.initializeAppCheck.mockImplementationOnce(() => {
      throw "plain";
    });
    await expect(m.ensureClosetAppCheck()).rejects.toBeInstanceOf(m.DeviceCheckError);
    await flush();
  });
});

describe("DeviceCheckError", () => {
  it("carries a plain message and a stable code", async () => {
    const m = await load();
    const err = new m.DeviceCheckError();
    expect(err.message).toBe(m.DEVICE_CHECK_FAILED_MESSAGE);
    expect(err.code).toBe("device_check_failed");
    expect(err.name).toBe("DeviceCheckError");
  });
});

describe("isDeviceCheckFailure", () => {
  it("matches our error, App Check SDK errors and the server's App Check rejection", async () => {
    const m = await load();
    expect(m.isDeviceCheckFailure(new m.DeviceCheckError())).toBe(true);
    expect(m.isDeviceCheckFailure({ code: "appCheck/recaptcha-error" })).toBe(true);
    expect(m.isDeviceCheckFailure({ code: "appCheck/throttled" })).toBe(true);
    expect(m.isDeviceCheckFailure({ code: "functions/unauthenticated", message: "Unauthenticated" })).toBe(true);
    expect(m.isDeviceCheckFailure({ code: "functions/failed-precondition", message: "app_check_required" })).toBe(true);
  });

  it("leaves every other error alone", async () => {
    const m = await load();
    expect(m.isDeviceCheckFailure(null)).toBe(false);
    expect(m.isDeviceCheckFailure("appCheck/x")).toBe(false);
    expect(m.isDeviceCheckFailure(new Error("nope"))).toBe(false);
    expect(m.isDeviceCheckFailure({ code: 7 })).toBe(false);
    expect(m.isDeviceCheckFailure({ code: "functions/unauthenticated", message: "unauthenticated" })).toBe(false);
    expect(m.isDeviceCheckFailure({ code: "functions/failed-precondition", message: "closet_disabled" })).toBe(false);
  });
});

describe("askDeviceCheckRetry", () => {
  it("answers no at once when no prompt is mounted", async () => {
    const m = await load();
    await expect(m.askDeviceCheckRetry()).resolves.toBe(false);
  });

  it("resolves with the first answer only", async () => {
    const m = await load();
    m.setDeviceCheckPrompt((decide) => {
      decide(true);
      decide(false);
    });
    await expect(m.askDeviceCheckRetry()).resolves.toBe(true);
    m.setDeviceCheckPrompt(null);
    await expect(m.askDeviceCheckRetry()).resolves.toBe(false);
  });
});
