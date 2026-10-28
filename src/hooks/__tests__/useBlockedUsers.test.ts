import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockSubscribeToBlockedUsers = vi.fn();

vi.mock("../../services/blocking", () => ({
  subscribeToBlockedUsers: (...args: unknown[]) => mockSubscribeToBlockedUsers(...args),
}));

import { useBlockedUsers, useBlockedUsersState } from "../useBlockedUsers";

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

    expect(mockSubscribeToBlockedUsers).toHaveBeenCalledWith("u1", expect.any(Function), expect.any(Function));
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
    expect(mockSubscribeToBlockedUsers).toHaveBeenCalledWith("u2", expect.any(Function), expect.any(Function));
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

type Update = (s: Set<string>) => void;

describe("useBlockedUsersState", () => {
  it("is ready immediately with no viewer", () => {
    const { result } = renderHook(() => useBlockedUsersState(""));
    expect(result.current.ready).toBe(true);
    expect(result.current.blocked.size).toBe(0);
  });

  it("is not ready until the first snapshot lands", () => {
    let push: Update = () => {};
    mockSubscribeToBlockedUsers.mockImplementation((_uid: string, onUpdate: Update) => {
      push = onUpdate;
      return vi.fn();
    });

    const { result } = renderHook(() => useBlockedUsersState("u1"));
    expect(result.current.ready).toBe(false);

    act(() => push(new Set(["u2"])));
    expect(result.current).toMatchObject({ blocked: new Set(["u2"]), ready: true });
  });

  it("fails open (ready, nothing filtered) when the listener errors", () => {
    let fail: () => void = () => {};
    mockSubscribeToBlockedUsers.mockImplementation((_uid: string, _onUpdate: Update, onError: () => void) => {
      fail = onError;
      return vi.fn();
    });

    const { result } = renderHook(() => useBlockedUsersState("u1"));
    act(() => fail());
    expect(result.current).toMatchObject({ blocked: new Set(), ready: true, failed: true });
  });

  it("drops the previous viewer's list while the next one loads", () => {
    const pushes: Update[] = [];
    mockSubscribeToBlockedUsers.mockImplementation((_uid: string, onUpdate: Update) => {
      pushes.push(onUpdate);
      return vi.fn();
    });

    const { result, rerender } = renderHook(({ uid }) => useBlockedUsersState(uid), {
      initialProps: { uid: "u1" },
    });
    act(() => pushes[0](new Set(["u9"])));
    expect(result.current.ready).toBe(true);

    rerender({ uid: "u2" });
    expect(result.current).toMatchObject({ blocked: new Set(), ready: false });
  });
});

describe("useBlockedUsersState — failed and retry", () => {
  type Listener = (uid: string, onUpdate: (s: Set<string>) => void, onError?: () => void) => () => void;

  it("is ready but failed when the listener errors before any snapshot", () => {
    mockSubscribeToBlockedUsers.mockImplementation(((_uid, _onUpdate, onError) => {
      onError?.();
      return vi.fn();
    }) as Listener);

    const { result } = renderHook(() => useBlockedUsersState("u1"));

    expect(result.current).toMatchObject({ ready: true, failed: true });
    expect(result.current.blocked.size).toBe(0);
  });

  it("keeps the last list and is not failed when the listener errors after a snapshot", () => {
    let fail: () => void = () => {};
    mockSubscribeToBlockedUsers.mockImplementation(((_uid, onUpdate, onError) => {
      onUpdate(new Set(["u2"]));
      fail = () => onError?.();
      return vi.fn();
    }) as Listener);

    const { result } = renderHook(() => useBlockedUsersState("u1"));
    act(() => fail());

    expect(result.current).toMatchObject({ ready: true, failed: false });
    expect(result.current.blocked).toEqual(new Set(["u2"]));
  });

  it("retry drops the listener, goes back to loading, and subscribes again", () => {
    const unsub = vi.fn();
    let answer: (s: Set<string>) => void = () => {};
    mockSubscribeToBlockedUsers
      .mockImplementationOnce(((_uid, _onUpdate, onError) => {
        onError?.();
        return unsub;
      }) as Listener)
      .mockImplementationOnce(((_uid, onUpdate) => {
        answer = onUpdate;
        return vi.fn();
      }) as Listener);

    const { result } = renderHook(() => useBlockedUsersState("u1"));
    expect(result.current.failed).toBe(true);

    act(() => result.current.retry());
    expect(unsub).toHaveBeenCalled();
    expect(mockSubscribeToBlockedUsers).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ ready: false, failed: false });

    act(() => answer(new Set(["u9"])));
    expect(result.current).toMatchObject({ ready: true, failed: false });
    expect(result.current.blocked).toEqual(new Set(["u9"]));
  });
});
