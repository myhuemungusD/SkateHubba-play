import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFeedMode } from "../useFeedMode";

const mockStorage = new Map<string, string>();

beforeEach(() => {
  mockStorage.clear();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => mockStorage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mockStorage.set(key, value);
      },
      removeItem: (key: string) => {
        mockStorage.delete(key);
      },
    },
    writable: true,
    configurable: true,
  });
});

describe("useFeedMode", () => {
  it("returns default mode 'scroll' when no stored mode", () => {
    const { result } = renderHook(() => useFeedMode());
    expect(result.current.mode).toBe("scroll");
  });

  it("loads stored mode from localStorage", () => {
    mockStorage.set("skatehubba_feed_mode", "name-it");

    const { result } = renderHook(() => useFeedMode());
    expect(result.current.mode).toBe("name-it");
  });

  it("updates mode and persists to localStorage", () => {
    const { result } = renderHook(() => useFeedMode());

    act(() => {
      result.current.setMode("vote");
    });

    expect(result.current.mode).toBe("vote");
    expect(mockStorage.get("skatehubba_feed_mode")).toBe("vote");
  });

  it("handles invalid stored mode by falling back to default", () => {
    mockStorage.set("skatehubba_feed_mode", "invalid-mode");

    const { result } = renderHook(() => useFeedMode());
    expect(result.current.mode).toBe("scroll");
  });

  it("handles localStorage errors gracefully", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("Storage error");
        },
        setItem: () => {
          throw new Error("Storage error");
        },
      },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useFeedMode());
    expect(result.current.mode).toBe("scroll");

    act(() => {
      result.current.setMode("name-it");
    });

    expect(result.current.mode).toBe("name-it");
  });
});
