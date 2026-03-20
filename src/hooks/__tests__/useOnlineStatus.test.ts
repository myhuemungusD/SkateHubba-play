import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOnlineStatus, subscribe, getSnapshot, getServerSnapshot } from "../useOnlineStatus";

describe("useOnlineStatus", () => {
  afterEach(() => {
    // Restore default (online)
    Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
  });

  it("returns true when the browser is online", () => {
    Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it("returns false when the browser is offline", () => {
    Object.defineProperty(navigator, "onLine", { value: false, writable: true, configurable: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
  });

  it("updates when going offline then back online", () => {
    Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      Object.defineProperty(navigator, "onLine", { value: false, writable: true, configurable: true });
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);

    act(() => {
      Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
  });

  it("getSnapshot returns navigator.onLine", () => {
    Object.defineProperty(navigator, "onLine", { value: false, writable: true, configurable: true });
    expect(getSnapshot()).toBe(false);
    Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
    expect(getSnapshot()).toBe(true);
  });

  it("getServerSnapshot returns true (SSR fallback)", () => {
    expect(getServerSnapshot()).toBe(true);
  });

  it("subscribe registers and unsubscribes listeners", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const cb = vi.fn();

    const unsub = subscribe(cb);
    expect(addSpy).toHaveBeenCalledWith("online", cb);
    expect(addSpy).toHaveBeenCalledWith("offline", cb);

    unsub();
    expect(removeSpy).toHaveBeenCalledWith("online", cb);
    expect(removeSpy).toHaveBeenCalledWith("offline", cb);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("removes event listeners on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useOnlineStatus());
    unmount();

    expect(removeSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("offline", expect.any(Function));

    removeSpy.mockRestore();
  });
});
