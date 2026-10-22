import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { isAgeGateBlocked, markAgeGateBlocked, markCoppaBlocked, useCoppaBlockedNotice } from "../coppaNotice";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  sessionStorage.clear();
  localStorage.clear();
});

function denyStorage(): void {
  for (const m of ["getItem", "setItem", "removeItem"] as const) {
    vi.spyOn(Storage.prototype, m).mockImplementation(() => {
      throw new Error("denied");
    });
  }
}

describe("landing notice", () => {
  it("is off until a block is marked, carries the outcome, and clears on dismiss", () => {
    const { result } = renderHook(() => useCoppaBlockedNotice());
    expect(result.current[0]).toBeNull();
    act(() => markCoppaBlocked("pending"));
    expect(result.current[0]).toBe("pending");
    act(() => markCoppaBlocked("deleted"));
    expect(result.current[0]).toBe("deleted");
    expect(sessionStorage.getItem("coppa_blocked_notice")).toBe("deleted");
    act(() => result.current[1]());
    expect(result.current[0]).toBeNull();
    expect(sessionStorage.getItem("coppa_blocked_notice")).toBeNull();
  });

  it("survives a remount in the same tab (the re-route after sign-out)", () => {
    markCoppaBlocked("deleted");
    const { result } = renderHook(() => useCoppaBlockedNotice());
    expect(result.current[0]).toBe("deleted");
  });

  it("ignores an unknown stored value", () => {
    sessionStorage.setItem("coppa_blocked_notice", "1");
    const { result } = renderHook(() => useCoppaBlockedNotice());
    expect(result.current[0]).toBeNull();
  });

  it("treats blocked storage as no notice instead of throwing", () => {
    denyStorage();
    const { result } = renderHook(() => useCoppaBlockedNotice());
    expect(() => act(() => markCoppaBlocked("deleted"))).not.toThrow();
    expect(result.current[0]).toBeNull();
  });
});

describe("sticky age-gate block", () => {
  it("holds for 24 hours, survives a notice dismiss, then expires", () => {
    vi.useFakeTimers();
    expect(isAgeGateBlocked()).toBe(false);
    markAgeGateBlocked();
    const { result } = renderHook(() => useCoppaBlockedNotice());
    act(() => result.current[1]());
    expect(isAgeGateBlocked()).toBe(true);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 1);
    expect(isAgeGateBlocked()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isAgeGateBlocked()).toBe(false);
    expect(localStorage.getItem("age_gate_blocked")).toBeNull();
  });

  it("stores only an expiry time, never an age or date", () => {
    markAgeGateBlocked();
    expect(localStorage.getItem("age_gate_blocked")).toMatch(/^\d+$/);
  });

  it("treats blocked storage as not blocked instead of throwing", () => {
    denyStorage();
    expect(() => markAgeGateBlocked()).not.toThrow();
    expect(isAgeGateBlocked()).toBe(false);
  });
});
