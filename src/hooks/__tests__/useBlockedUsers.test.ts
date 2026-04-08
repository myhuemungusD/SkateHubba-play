import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockSubscribeToBlockedUsers = vi.fn();

vi.mock("../../services/block", () => ({
  subscribeToBlockedUsers: (...args: unknown[]) => mockSubscribeToBlockedUsers(...args),
}));

import { useBlockedUsers } from "../useBlockedUsers";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useBlockedUsers", () => {
  it("returns empty set when uid is empty", () => {
    const { result } = renderHook(() => useBlockedUsers(""));
    expect(result.current.size).toBe(0);
    expect(mockSubscribeToBlockedUsers).not.toHaveBeenCalled();
  });

  it("subscribes to blocked users when uid is provided", () => {
    mockSubscribeToBlockedUsers.mockImplementation((_uid: string, onUpdate: (s: Set<string>) => void) => {
      onUpdate(new Set(["u2", "u3"]));
      return vi.fn();
    });

    const { result } = renderHook(() => useBlockedUsers("u1"));

    expect(mockSubscribeToBlockedUsers).toHaveBeenCalledWith("u1", expect.any(Function));
    expect(result.current).toEqual(new Set(["u2", "u3"]));
  });

  it("unsubscribes on unmount", () => {
    const unsub = vi.fn();
    mockSubscribeToBlockedUsers.mockReturnValue(unsub);

    const { unmount } = renderHook(() => useBlockedUsers("u1"));
    unmount();

    expect(unsub).toHaveBeenCalled();
  });

  it("re-subscribes when uid changes", () => {
    const unsub1 = vi.fn();
    const unsub2 = vi.fn();
    mockSubscribeToBlockedUsers.mockReturnValueOnce(unsub1).mockReturnValueOnce(unsub2);

    const { rerender } = renderHook(({ uid }) => useBlockedUsers(uid), {
      initialProps: { uid: "u1" },
    });

    rerender({ uid: "u2" });

    expect(unsub1).toHaveBeenCalled();
    expect(mockSubscribeToBlockedUsers).toHaveBeenCalledWith("u2", expect.any(Function));
  });

  it("updates when subscription fires with new data", () => {
    let capturedCallback: (s: Set<string>) => void;
    mockSubscribeToBlockedUsers.mockImplementation((_uid: string, onUpdate: (s: Set<string>) => void) => {
      capturedCallback = onUpdate;
      onUpdate(new Set(["u2"]));
      return vi.fn();
    });

    const { result } = renderHook(() => useBlockedUsers("u1"));
    expect(result.current).toEqual(new Set(["u2"]));

    act(() => {
      capturedCallback(new Set(["u2", "u3"]));
    });

    expect(result.current).toEqual(new Set(["u2", "u3"]));
  });

  it("returns empty set when uid becomes empty", () => {
    mockSubscribeToBlockedUsers.mockImplementation((_uid: string, onUpdate: (s: Set<string>) => void) => {
      onUpdate(new Set(["u2"]));
      return vi.fn();
    });

    const { result, rerender } = renderHook(({ uid }) => useBlockedUsers(uid), {
      initialProps: { uid: "u1" },
    });

    expect(result.current.size).toBe(1);

    rerender({ uid: "" });

    expect(result.current.size).toBe(0);
  });
});
