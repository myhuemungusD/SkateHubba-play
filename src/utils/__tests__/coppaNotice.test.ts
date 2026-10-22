import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { markCoppaBlocked, useCoppaBlockedNotice } from "../coppaNotice";

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("coppaNotice", () => {
  it("is off until a block is marked, then off again once dismissed", () => {
    const { result } = renderHook(() => useCoppaBlockedNotice());
    expect(result.current[0]).toBe(false);
    act(() => markCoppaBlocked());
    expect(result.current[0]).toBe(true);
    expect(sessionStorage.getItem("coppa_blocked_notice")).toBe("1");
    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    expect(sessionStorage.getItem("coppa_blocked_notice")).toBeNull();
  });

  it("survives a remount in the same tab (the re-route after sign-out)", () => {
    markCoppaBlocked();
    const { result } = renderHook(() => useCoppaBlockedNotice());
    expect(result.current[0]).toBe(true);
  });

  it("treats blocked storage as no notice instead of throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { result } = renderHook(() => useCoppaBlockedNotice());
    expect(() => act(() => markCoppaBlocked())).not.toThrow();
    expect(result.current[0]).toBe(false);
  });
});
