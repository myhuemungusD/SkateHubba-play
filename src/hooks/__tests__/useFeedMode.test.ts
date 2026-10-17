import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
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
    expect(result.current.feedMode).toBe("scroll");
  });

  it("loads stored mode from localStorage", () => {
    mockStorage.set("skatehubba.feedMode", "name-it");

    const { result } = renderHook(() => useFeedMode());
    expect(result.current.feedMode).toBe("name-it");
  });

  it("updates mode and persists to localStorage", () => {
    const { result } = renderHook(() => useFeedMode());

    act(() => {
      result.current.setFeedMode("vote");
    });

    expect(result.current.feedMode).toBe("vote");
    expect(mockStorage.get("skatehubba.feedMode")).toBe("vote");
  });

  it("handles invalid stored mode by falling back to default", () => {
    mockStorage.set("skatehubba.feedMode", "invalid-mode");

    const { result } = renderHook(() => useFeedMode());
    expect(result.current.feedMode).toBe("scroll");
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
    expect(result.current.feedMode).toBe("scroll");

    act(() => {
      result.current.setFeedMode("name-it");
    });

    expect(result.current.feedMode).toBe("name-it");
  });
});
