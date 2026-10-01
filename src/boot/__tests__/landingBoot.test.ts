import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AUTH_HINT_KEY,
  FIREBASE_AUTH_IDB_NAME,
  __resetLandingBootForTest,
  afterLandingPainted,
  clearBootAuthMode,
  hasBootGoogleSignIn,
  isLandingBooted,
  peekBootAuthMode,
  requestBootGoogleSignIn,
  runWhenIdle,
  setBootAuthMode,
  setLandingBooted,
  shouldBootLanding,
  takeBootGoogleSignIn,
  writeAuthHint,
} from "../landingBoot";

const idbWith = (...names: string[]) => ({ databases: vi.fn().mockResolvedValue(names.map((name) => ({ name }))) });

beforeEach(() => {
  localStorage.clear();
  __resetLandingBootForTest();
});

describe("shouldBootLanding", () => {
  it("never boots on native or off the landing path", async () => {
    expect(await shouldBootLanding("/", true, idbWith())).toBe(false);
    expect(await shouldBootLanding("/auth", false, idbWith())).toBe(false);
  });

  it("follows the auth hint when present", async () => {
    writeAuthHint(true);
    expect(localStorage.getItem(AUTH_HINT_KEY)).toBe("1");
    expect(await shouldBootLanding("/", false, idbWith())).toBe(false);
    writeAuthHint(false);
    expect(await shouldBootLanding("/", false, idbWith(FIREBASE_AUTH_IDB_NAME))).toBe(true);
  });

  it("without a hint, boots only when Firebase Auth has never run here", async () => {
    expect(await shouldBootLanding("/", false, idbWith("other"))).toBe(true);
    expect(await shouldBootLanding("/", false, idbWith(FIREBASE_AUTH_IDB_NAME))).toBe(false);
  });

  it("falls back to the normal path when the answer is unknown", async () => {
    expect(await shouldBootLanding("/", false, undefined)).toBe(false);
    expect(await shouldBootLanding("/", false, {})).toBe(false);
    expect(await shouldBootLanding("/", false, { databases: vi.fn().mockRejectedValue(new Error("x")) })).toBe(false);
  });

  it("defaults to the global indexedDB (absent in jsdom → normal path)", async () => {
    expect(await shouldBootLanding("/", false)).toBe(false);
  });

  it("treats unreadable / unwritable storage as no hint", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => writeAuthHint(true)).not.toThrow();
    expect(await shouldBootLanding("/", false, idbWith())).toBe(true);
    get.mockRestore();
    set.mockRestore();
  });
});

describe("boot state and intents", () => {
  it("tracks the boot flag", () => {
    expect(isLandingBooted()).toBe(false);
    setLandingBooted(true);
    expect(isLandingBooted()).toBe(true);
  });

  it("carries the chosen auth mode until cleared", () => {
    expect(peekBootAuthMode()).toBeNull();
    setBootAuthMode("signin");
    expect(peekBootAuthMode()).toBe("signin");
    clearBootAuthMode();
    expect(peekBootAuthMode()).toBeNull();
  });

  it("hands out a Google sign-in request exactly once", () => {
    expect(takeBootGoogleSignIn()).toBe(false);
    requestBootGoogleSignIn();
    expect(hasBootGoogleSignIn()).toBe(true);
    expect(takeBootGoogleSignIn()).toBe(true);
    expect(takeBootGoogleSignIn()).toBe(false);
  });
});

describe("afterLandingPainted", () => {
  const realPO = globalThis.PerformanceObserver;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    globalThis.PerformanceObserver = realPO;
  });

  it("waits for the first LCP entry when the browser reports LCP", () => {
    let fire: (() => void) | undefined;
    const disconnect = vi.fn();
    const observe = vi.fn();
    globalThis.PerformanceObserver = Object.assign(
      vi.fn(function (this: unknown, cb: () => void) {
        fire = cb;
        return { observe, disconnect };
      }),
      { supportedEntryTypes: ["largest-contentful-paint"] },
    ) as unknown as typeof PerformanceObserver;
    const cb = vi.fn();
    afterLandingPainted(cb);
    expect(observe).toHaveBeenCalledWith({ type: "largest-contentful-paint", buffered: true });
    vi.advanceTimersByTime(100);
    expect(cb).not.toHaveBeenCalled();
    fire?.();
    expect(disconnect).toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(cb).toHaveBeenCalledTimes(1);
    // The max-wait fallback must not run it a second time.
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("without LCP support, runs after load (document already complete)", () => {
    globalThis.PerformanceObserver = undefined as unknown as typeof PerformanceObserver;
    const cb = vi.fn();
    afterLandingPainted(cb);
    vi.advanceTimersByTime(50);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("without LCP support, waits for the load event or the max wait", () => {
    globalThis.PerformanceObserver = Object.assign(vi.fn(), {
      supportedEntryTypes: [],
    }) as unknown as typeof PerformanceObserver;
    const state = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const cb = vi.fn();
    afterLandingPainted(cb, 1000);
    vi.advanceTimersByTime(100);
    expect(cb).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(50);
    expect(cb).toHaveBeenCalledTimes(1);

    const cb2 = vi.fn();
    afterLandingPainted(cb2, 1000);
    vi.advanceTimersByTime(1100);
    expect(cb2).toHaveBeenCalledTimes(1);
    state.mockRestore();
  });
});

describe("runWhenIdle", () => {
  afterEach(() => {
    delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
    vi.useRealTimers();
  });

  it("uses requestIdleCallback with a timeout when available", () => {
    const ric = vi.fn((fn: () => void) => {
      fn();
      return 1;
    });
    (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = ric;
    const cb = vi.fn();
    runWhenIdle(cb, 1234);
    expect(ric).toHaveBeenCalledWith(cb, { timeout: 1234 });
    expect(cb).toHaveBeenCalled();
  });

  it("falls back to a timer", () => {
    vi.useFakeTimers();
    delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
    const cb = vi.fn();
    runWhenIdle(cb);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5);
    expect(cb).toHaveBeenCalled();
  });
});
