import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useReducedMotion,
  subscribe,
  getSnapshot,
  getServerSnapshot,
  __resetCachedMqlForTest,
} from "../useReducedMotion";

interface FakeMql {
  matches: boolean;
  listeners: Set<() => void>;
  addEventListener: (event: string, cb: () => void) => void;
  removeEventListener: (event: string, cb: () => void) => void;
}

function makeFakeMql(initial = false): FakeMql {
  const listeners = new Set<() => void>();
  return {
    matches: initial,
    listeners,
    addEventListener: vi.fn((event: string, cb: () => void) => {
      if (event === "change") listeners.add(cb);
    }),
    removeEventListener: vi.fn((event: string, cb: () => void) => {
      if (event === "change") listeners.delete(cb);
    }),
  };
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  __resetCachedMqlForTest();
  // Restore the original matchMedia so other tests aren't affected.
  Object.defineProperty(window, "matchMedia", {
    value: originalMatchMedia,
    writable: true,
    configurable: true,
  });
});

function installMatchMedia(initialMatches: boolean): FakeMql {
  const mql = makeFakeMql(initialMatches);
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn().mockReturnValue(mql),
    writable: true,
    configurable: true,
  });
  return mql;
}

describe("useReducedMotion", () => {
  it.each([
    ["no preference", false],
    ["reduce preference", true],
  ] as const)("returns %s synchronously when matchMedia reports %s", (_label, value) => {
    installMatchMedia(value);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(value);
  });

  it("updates when MediaQueryList fires change", () => {
    const mql = installMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      mql.matches = true;
      mql.listeners.forEach((cb) => cb());
    });
    expect(result.current).toBe(true);
  });

  it("removes the change listener on unmount", () => {
    const mql = installMatchMedia(false);
    const { unmount } = renderHook(() => useReducedMotion());
    expect(mql.listeners.size).toBe(1);
    unmount();
    expect(mql.listeners.size).toBe(0);
  });

  it("falls back to false when window.matchMedia is undefined (SSR-safe)", () => {
    Object.defineProperty(window, "matchMedia", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    expect(getSnapshot()).toBe(false);
    // subscribe should return a no-op cleanup without throwing
    const cleanup = subscribe(() => undefined);
    expect(() => cleanup()).not.toThrow();
  });

  it("getServerSnapshot returns false (animations on by default during SSR)", () => {
    expect(getServerSnapshot()).toBe(false);
  });

  it("subscribe registers and unregisters via addEventListener/removeEventListener", () => {
    const mql = installMatchMedia(false);
    const cb = vi.fn();
    const cleanup = subscribe(cb);
    expect(mql.addEventListener).toHaveBeenCalledWith("change", cb);
    cleanup();
    expect(mql.removeEventListener).toHaveBeenCalledWith("change", cb);
  });
});
