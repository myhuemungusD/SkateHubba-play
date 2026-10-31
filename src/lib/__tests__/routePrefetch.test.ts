import { afterEach, describe, expect, it, vi } from "vitest";

// The real screen chunks are heavy; stand each one in with a module that
// records when the default loader pulls it in.
const pulled = vi.hoisted(() => [] as string[]);
vi.mock("../../screens/FeedScreen", () => (pulled.push("feed"), {}));
vi.mock("../../screens/MapPage", () => (pulled.push("map"), {}));
vi.mock("../../screens/GamePlayScreen", () => (pulled.push("game"), {}));
vi.mock("../../screens/GameOverScreen", () => (pulled.push("gameOver"), {}));
vi.mock("../../screens/PlayerProfileScreen", () => (pulled.push("me"), {}));
vi.mock("../../screens/Settings", () => (pulled.push("settings"), {}));
vi.mock("../../screens/ChallengeScreen", () => (pulled.push("challenge"), {}));
vi.mock("../../screens/MyStatsScreen", () => (pulled.push("myStats"), {}));
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

  it("is off by default under the test build mode", () => {
    const add = vi.spyOn(window, "addEventListener");
    prefetchLikelyRoutes("/lobby");
    prefetchLikelyRoutes("/lobby", { loaders: loaders() });
    expect(add).not.toHaveBeenCalled();
    add.mockRestore();
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

describe("prefetchLikelyRoutes queue lifecycle", () => {
  /** Idle callbacks wait in a list so a test can run them one at a time. */
  function queuedIdle(): Array<() => void> {
    const idle: Array<() => void> = [];
    window.requestIdleCallback = ((cb: () => void) => idle.push(cb)) as unknown as typeof window.requestIdleCallback;
    return idle;
  }

  async function runIdle(idle: Array<() => void>): Promise<void> {
    while (idle.length) {
      idle.shift()?.();
      await vi.advanceTimersByTimeAsync(0);
    }
  }

  it("stops draining the old route once the viewer navigates", async () => {
    vi.useFakeTimers();
    const idle = queuedIdle();
    const kit = loaders();
    prefetchLikelyRoutes("/lobby", { enabled: true, loaders: kit });
    window.dispatchEvent(new Event("keydown"));
    idle.shift()?.(); // kick -> first chunk
    await vi.advanceTimersByTimeAsync(0);
    expect(kit.calls).toEqual(["game"]);
    expect(idle).toHaveLength(1); // the next drain slice is queued
    const next = loaders();
    prefetchLikelyRoutes("/settings", { enabled: true, loaders: next });
    await runIdle(idle);
    expect(kit.calls).toEqual(["game"]);
    expect(next.calls).toEqual([]);
  });

  it("does not queue another slice when navigation lands mid-download", async () => {
    vi.useFakeTimers();
    const idle = queuedIdle();
    const kit = loaders();
    let release: (v: unknown) => void = () => undefined;
    kit.gameOver = () => {
      kit.calls.push("gameOver");
      return new Promise((r) => (release = r));
    };
    prefetchLikelyRoutes("/game", { enabled: true, loaders: kit });
    window.dispatchEvent(new Event("pointerdown"));
    idle.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(kit.calls).toEqual(["gameOver"]);
    __resetRoutePrefetchForTest();
    release(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(idle).toEqual([]);
  });

  it("falls back to the real screen chunks when no loaders are passed", async () => {
    // Start from an empty module registry so every chunk import below runs its
    // mock factory again, whatever earlier tests already pulled in.
    vi.resetModules();
    pulled.length = 0;
    vi.useFakeTimers();
    const idle = queuedIdle();
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
    for (const path of ["/lobby", "/me", "/game"]) {
      prefetchLikelyRoutes(path, { enabled: true });
      window.dispatchEvent(new Event("keydown"));
      await runIdle(idle);
    }
    expect([...pulled].sort()).toEqual(
      ["challenge", "feed", "game", "gameOver", "map", "me", "myStats", "settings"].sort(),
    );
  });
});
