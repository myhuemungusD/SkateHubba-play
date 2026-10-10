import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetCacheWorkerForTest, registerCacheWorker } from "../registerCacheSw";
import { __resetSwClaimForTest, claimMessagingWorker } from "../swClaim";

afterEach(() => {
  __resetCacheWorkerForTest();
  __resetSwClaimForTest();
  vi.useRealTimers();
  delete (window as { requestIdleCallback?: unknown }).requestIdleCallback;
  delete (window as { Capacitor?: unknown }).Capacitor;
});

function armIdle(): void {
  vi.useFakeTimers();
  window.requestIdleCallback = ((cb: () => void) => {
    cb();
    return 1;
  }) as unknown as typeof window.requestIdleCallback;
}

describe("registerCacheWorker", () => {
  it("registers the asset cache once the page has been quiet", async () => {
    armIdle();
    const register = vi.fn().mockResolvedValue({});
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register, getRegistrations: vi.fn().mockResolvedValue([]) },
      configurable: true,
    });
    registerCacheWorker({ enabled: true });
    registerCacheWorker({ enabled: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith("/asset-cache-sw.js");
  });

  it("leaves an existing messaging worker in place", async () => {
    armIdle();
    const register = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        register,
        getRegistrations: vi
          .fn()
          .mockResolvedValue([
            {
              active: { scriptURL: "https://skatehubba.com/firebase-messaging-sw.js" },
              waiting: null,
              installing: null,
            },
          ]),
      },
      configurable: true,
    });
    registerCacheWorker({ enabled: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(register).not.toHaveBeenCalled();
  });

  it("skips when push registration already claimed the scope", async () => {
    armIdle();
    claimMessagingWorker();
    const register = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register, getRegistrations: vi.fn().mockResolvedValue([]) },
      configurable: true,
    });
    registerCacheWorker({ enabled: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(register).not.toHaveBeenCalled();
  });

  it("retries after a failed registration", async () => {
    armIdle();
    const register = vi.fn().mockRejectedValueOnce(new Error("no")).mockResolvedValue({});
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register, getRegistrations: vi.fn().mockResolvedValue([]) },
      configurable: true,
    });
    registerCacheWorker({ enabled: true });
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();
    __resetCacheWorkerForTest();
    registerCacheWorker({ enabled: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(register).toHaveBeenCalledTimes(2);
  });

  it("skips the native shell and browsers without a service worker", async () => {
    armIdle();
    (window as unknown as { Capacitor: { isNativePlatform: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    };
    const register = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register, getRegistrations: vi.fn() },
      configurable: true,
    });
    registerCacheWorker({ enabled: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(register).not.toHaveBeenCalled();

    __resetCacheWorkerForTest();
    delete (window as { Capacitor?: unknown }).Capacitor;
    Object.defineProperty(navigator, "serviceWorker", { value: undefined, configurable: true });
    expect(() => registerCacheWorker({ enabled: true })).not.toThrow();
  });

  it("does nothing in the default test mode", () => {
    expect(() => registerCacheWorker()).not.toThrow();
  });
});
