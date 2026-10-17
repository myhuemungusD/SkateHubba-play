import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetRoutePrefetchForTest,
  canPrefetch,
  canPrefetchHeavy,
  normalizePath,
  prefetchLikelyRoutes,
  routesForPath,
  type RouteLoaders,
} from "../routePrefetch";

function loaders(): RouteLoaders & { calls: string[] } {
  const calls: string[] = [];
  const make = (name: string) => () => {
    calls.push(name);
    return Promise.resolve(name);
  };
  return {
    calls,
    feed: make("feed"),
    map: make("map"),
    game: make("game"),
    gameOver: make("gameOver"),
    me: make("me"),
    settings: make("settings"),
    challenge: make("challenge"),
    myStats: make("myStats"),
  };
}

function setConnection(value: { saveData?: boolean; effectiveType?: string } | undefined): void {
  Object.defineProperty(navigator, "connection", { value, configurable: true });
}

afterEach(() => {
  __resetRoutePrefetchForTest();
  setConnection(undefined);
  vi.unstubAllEnvs();
  vi.useRealTimers();
  delete (window as { requestIdleCallback?: unknown }).requestIdleCallback;
});

describe("routesForPath", () => {
  it("normalizes a trailing slash", () => {
    expect(normalizePath("/auth/")).toBe("/auth");
    expect(normalizePath("/")).toBe("/");
  });

  it("prefetches the feed from home and auth only when extras are on", () => {
    const kit = loaders();
    expect(routesForPath("/", kit, { extras: true, heavy: true })).toEqual([kit.feed]);
    expect(routesForPath("/auth/", kit, { extras: false, heavy: true })).toEqual([]);
  });

  it("prefetches the game, profile, and map from the lobby", () => {
    const kit = loaders();
    expect(routesForPath("/lobby", kit, { extras: true, heavy: true })).toEqual([
      kit.game,
      kit.me,
      kit.challenge,
      kit.feed,
      kit.map,
    ]);
    expect(routesForPath("/lobby", kit, { extras: true, heavy: false })).toEqual([
      kit.game,
      kit.me,
      kit.challenge,
      kit.feed,
    ]);
    expect(routesForPath("/lobby", kit, { extras: false, heavy: true })).toEqual([
      kit.game,
      kit.me,
      kit.challenge,
      kit.map,
    ]);
  });

  it("maps each signed-in screen to its neighbor", () => {
    const kit = loaders();
    const opts = { extras: true, heavy: false };
    expect(routesForPath("/feed", kit, opts)).toEqual([kit.challenge, kit.me]);
    expect(routesForPath("/feed", kit, { extras: true, heavy: true })).toEqual([kit.challenge, kit.me, kit.map]);
    expect(routesForPath("/map", kit, opts)).toEqual([kit.me, kit.challenge]);
    expect(routesForPath("/me", kit, opts)).toEqual([kit.settings, kit.myStats, kit.challenge]);
    expect(routesForPath("/game", kit, opts)).toEqual([kit.gameOver]);
    expect(routesForPath("/challenge", kit, opts)).toEqual([kit.game]);
    expect(routesForPath("/settings", kit, opts)).toEqual([kit.me]);
    expect(routesForPath("/gameover", kit, opts)).toEqual([kit.me]);
    expect(routesForPath("/player/abc", kit, opts)).toEqual([]);
  });
});

describe("canPrefetch", () => {
  it("skips data-saver and 2g, and keeps map off 3g", () => {
    setConnection(undefined);
    expect(canPrefetch()).toBe(true);
    expect(canPrefetchHeavy()).toBe(true);
    setConnection({ saveData: true, effectiveType: "4g" });
    expect(canPrefetch()).toBe(false);
    expect(canPrefetchHeavy()).toBe(false);
    setConnection({ effectiveType: "2g" });
    expect(canPrefetch()).toBe(false);
    setConnection({ effectiveType: "slow-2g" });
    expect(canPrefetch()).toBe(false);
    setConnection({ effectiveType: "3g" });
    expect(canPrefetch()).toBe(true);
    expect(canPrefetchHeavy()).toBe(false);
    setConnection({ effectiveType: "4g" });
    expect(canPrefetchHeavy()).toBe(true);
  });
});

describe("prefetchLikelyRoutes", () => {
  it("does nothing when disabled", () => {
    const kit = loaders();
    prefetchLikelyRoutes("/lobby", { enabled: false, loaders: kit });
    expect(kit.calls).toEqual([]);
  });

  it("drains one chunk per idle slice after the quiet delay", async () => {
    vi.useFakeTimers();
    const ric = vi.fn((cb: () => void) => {
      cb();
      return 1;
    });
    window.requestIdleCallback = ric as unknown as typeof window.requestIdleCallback;
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
    const kit = loaders();
    prefetchLikelyRoutes("/", { enabled: true, loaders: kit });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(kit.calls).toEqual(["feed"]);
  });

  it("starts on the first pointer or key before the quiet delay", async () => {
    vi.useFakeTimers();
    window.requestIdleCallback = ((cb: () => void) => {
      cb();
      return 1;
    }) as unknown as typeof window.requestIdleCallback;
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "false");
    const kit = loaders();
    prefetchLikelyRoutes("/game", { enabled: true, loaders: kit });
    window.dispatchEvent(new Event("pointerdown"));
    await vi.advanceTimersByTimeAsync(0);
    expect(kit.calls).toEqual(["gameOver"]);
    window.dispatchEvent(new Event("keydown"));
    expect(kit.calls).toEqual(["gameOver"]);
  });

  it("drops a rejected chunk and continues", async () => {
    vi.useFakeTimers();
    window.requestIdleCallback = ((cb: () => void) => {
      cb();
      return 1;
    }) as unknown as typeof window.requestIdleCallback;
    const kit = loaders();
    kit.game = () => Promise.reject(new Error("chunk"));
    prefetchLikelyRoutes("/lobby", { enabled: true, loaders: kit });
    window.dispatchEvent(new Event("keydown"));
    await vi.advanceTimersByTimeAsync(0);
    expect(kit.calls).toContain("me");
  });

  it("does not download chunks on data saver", async () => {
    vi.useFakeTimers();
    window.requestIdleCallback = ((cb: () => void) => {
      cb();
      return 1;
    }) as unknown as typeof window.requestIdleCallback;
    setConnection({ saveData: true });
    const kit = loaders();
    prefetchLikelyRoutes("/game", { enabled: true, loaders: kit });
    window.dispatchEvent(new Event("pointerdown"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(kit.calls).toEqual([]);
  });
});
