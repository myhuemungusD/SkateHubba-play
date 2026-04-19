import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePullToRefresh } from "../usePullToRefresh";

vi.mock("../../services/haptics", () => ({
  playHaptic: vi.fn(),
}));

/** Build a pointer-event-shaped object the hook actually reads. The real
 *  React.PointerEvent type has far more fields we don't touch. */
function pointerEvent(overrides: Partial<{ clientY: number; isPrimary: boolean }> = {}) {
  return {
    clientY: 0,
    isPrimary: true,
    ...overrides,
  } as unknown as React.PointerEvent;
}

beforeEach(() => {
  // Clear mock call history between tests — the haptic mock is module-scoped
  // and would otherwise leak counts from earlier cases into the pulse-once
  // assertion.
  vi.clearAllMocks();
  // jsdom's default scrollY is 0 which is exactly the pre-condition we want;
  // some tests override via Object.defineProperty below.
  Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 0 });
  Object.defineProperty(document.documentElement, "scrollTop", {
    configurable: true,
    writable: true,
    value: 0,
  });
});

describe("usePullToRefresh", () => {
  it("starts idle with zero offset", () => {
    const { result } = renderHook(() => usePullToRefresh(vi.fn()));
    expect(result.current.offset).toBe(0);
    expect(result.current.state).toBe("idle");
    expect(result.current.triggerReached).toBe(false);
  });

  it("ignores non-primary pointers", () => {
    const { result } = renderHook(() => usePullToRefresh(vi.fn()));
    act(() => {
      result.current.containerProps.onPointerDown(pointerEvent({ isPrimary: false, clientY: 0 }));
    });
    act(() => {
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 200 }));
    });
    expect(result.current.offset).toBe(0);
  });

  it("ignores pointerDown mid-scroll", () => {
    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 100 });
    const { result } = renderHook(() => usePullToRefresh(vi.fn()));
    act(() => {
      result.current.containerProps.onPointerDown(pointerEvent({ clientY: 0 }));
    });
    act(() => {
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 200 }));
    });
    expect(result.current.offset).toBe(0);
  });

  it("enters pulling state on downward drag and advances to ready past the threshold", () => {
    const { result } = renderHook(() => usePullToRefresh(vi.fn()));
    act(() => {
      result.current.containerProps.onPointerDown(pointerEvent({ clientY: 0 }));
    });
    act(() => {
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 40 }));
    });
    expect(result.current.state).toBe("pulling");
    expect(result.current.offset).toBeGreaterThan(0);
    expect(result.current.triggerReached).toBe(false);

    act(() => {
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 300 }));
    });
    expect(result.current.state).toBe("ready");
    expect(result.current.triggerReached).toBe(true);
  });

  it("resists past the max drag", () => {
    const { result } = renderHook(() => usePullToRefresh(vi.fn()));
    act(() => {
      result.current.containerProps.onPointerDown(pointerEvent({ clientY: 0 }));
    });
    act(() => {
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 1000 }));
    });
    expect(result.current.offset).toBeLessThanOrEqual(140);
  });

  it("collapses offset when the user drags upward after pulling down", () => {
    const { result } = renderHook(() => usePullToRefresh(vi.fn()));
    act(() => {
      result.current.containerProps.onPointerDown(pointerEvent({ clientY: 0 }));
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 100 }));
    });
    expect(result.current.offset).toBeGreaterThan(0);
    act(() => {
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: -5 }));
    });
    expect(result.current.offset).toBe(0);
    expect(result.current.state).toBe("idle");
  });

  it("fires onRefresh on release past the threshold and resets when it resolves", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      result.current.containerProps.onPointerDown(pointerEvent({ clientY: 0 }));
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 300 }));
    });

    await act(async () => {
      result.current.containerProps.onPointerUp(pointerEvent());
      // Flush the microtask queue so the .finally() resets state.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onRefresh).toHaveBeenCalledOnce();
    expect(result.current.state).toBe("idle");
    expect(result.current.offset).toBe(0);
  });

  it("does not fire onRefresh when release happens before the threshold", () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      result.current.containerProps.onPointerDown(pointerEvent({ clientY: 0 }));
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 30 }));
      result.current.containerProps.onPointerUp(pointerEvent());
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
  });

  it("no-ops pointerUp when pointerDown was never recorded", () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() => usePullToRefresh(onRefresh));
    act(() => {
      result.current.containerProps.onPointerUp(pointerEvent());
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("no-ops pointerMove when pointerDown was never recorded", () => {
    const { result } = renderHook(() => usePullToRefresh(vi.fn()));
    act(() => {
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 200 }));
    });
    expect(result.current.offset).toBe(0);
  });

  it("resets on pointer cancel", () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() => usePullToRefresh(onRefresh));
    act(() => {
      result.current.containerProps.onPointerDown(pointerEvent({ clientY: 0 }));
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 300 }));
    });
    expect(result.current.state).toBe("ready");

    act(() => {
      result.current.containerProps.onPointerCancel(pointerEvent());
    });
    expect(result.current.state).toBe("idle");
    expect(result.current.offset).toBe(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("still resets even when the refresh callback rejects", async () => {
    const onRefresh = vi.fn().mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      result.current.containerProps.onPointerDown(pointerEvent({ clientY: 0 }));
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 300 }));
    });

    await act(async () => {
      result.current.containerProps.onPointerUp(pointerEvent());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.offset).toBe(0);
  });

  it("supports synchronous refresh callbacks", async () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      result.current.containerProps.onPointerDown(pointerEvent({ clientY: 0 }));
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 300 }));
    });

    await act(async () => {
      result.current.containerProps.onPointerUp(pointerEvent());
      await Promise.resolve();
    });

    expect(onRefresh).toHaveBeenCalledOnce();
    expect(result.current.state).toBe("idle");
  });

  it("fires a haptic pulse exactly once when crossing the trigger threshold", async () => {
    const { playHaptic } = await import("../../services/haptics");
    const haptic = playHaptic as ReturnType<typeof vi.fn>;
    const { result } = renderHook(() => usePullToRefresh(vi.fn()));

    act(() => {
      result.current.containerProps.onPointerDown(pointerEvent({ clientY: 0 }));
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 100 }));
    });
    expect(haptic).not.toHaveBeenCalled();

    act(() => {
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 400 }));
    });
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledWith("toast");

    // Further moves past the threshold don't re-fire the haptic.
    act(() => {
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 450 }));
    });
    expect(haptic).toHaveBeenCalledTimes(1);
  });

  it("uses the latest onRefresh callback without re-binding pointer handlers", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ fn }: { fn: () => void }) => usePullToRefresh(fn), {
      initialProps: { fn: first },
    });

    // Capture the first round of handlers, then re-render with a new callback.
    const handlersBefore = result.current.containerProps;
    rerender({ fn: second });
    expect(result.current.containerProps).toBe(handlersBefore);

    act(() => {
      result.current.containerProps.onPointerDown(pointerEvent({ clientY: 0 }));
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 300 }));
    });
    await act(async () => {
      result.current.containerProps.onPointerUp(pointerEvent());
      await Promise.resolve();
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
