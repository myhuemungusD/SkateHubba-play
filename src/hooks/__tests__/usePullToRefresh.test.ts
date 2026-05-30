import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePullToRefresh } from "../usePullToRefresh";

vi.mock("../../services/haptics", () => ({
  playHaptic: vi.fn(),
}));

/** Build a pointer-event-shaped object the hook actually reads. The real
 *  React.PointerEvent type has far more fields we don't touch. */
function pointerEvent(
  overrides: Partial<{
    clientY: number;
    isPrimary: boolean;
    cancelable: boolean;
    preventDefault: () => void;
  }> = {},
) {
  return {
    clientY: 0,
    isPrimary: true,
    cancelable: true,
    preventDefault: () => undefined,
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

  it("ignores pointerMove events fired after the gesture has committed to a refresh", async () => {
    // Hold the refresh unresolved so we stay in the committed window.
    let resolveRefresh!: () => void;
    const onRefresh = vi.fn().mockReturnValue(
      new Promise<void>((r) => {
        resolveRefresh = r;
      }),
    );
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      result.current.containerProps.onPointerDown(pointerEvent({ clientY: 0 }));
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 300 }));
      result.current.containerProps.onPointerUp(pointerEvent());
    });

    // State is "refreshing"; any late pointermove (e.g. delayed synthetic
    // event fired after release) should be ignored rather than re-positioning
    // the indicator or stomping on the committed state.
    expect(result.current.state).toBe("refreshing");
    const committedOffset = result.current.offset;
    act(() => {
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 40 }));
    });
    expect(result.current.state).toBe("refreshing");
    expect(result.current.offset).toBe(committedOffset);

    // Clean up so the hook resets for any downstream tests.
    await act(async () => {
      resolveRefresh();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("latches the ready state once crossed — pullback under threshold keeps the commit visual", () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePullToRefresh(onRefresh));

    act(() => {
      result.current.containerProps.onPointerDown(pointerEvent({ clientY: 0 }));
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 300 }));
    });
    expect(result.current.state).toBe("ready");
    expect(result.current.triggerReached).toBe(true);

    // User pulls back to a smaller (but still positive) offset. The resistance
    // formula for clientY=120 gives ~54px offset, which is below the 72px
    // trigger distance. We intentionally keep state="ready" so the visual
    // (label, color, arrow rotation) matches the commit that release will
    // actually fire.
    act(() => {
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 120 }));
    });
    expect(result.current.offset).toBeLessThan(72);
    expect(result.current.state).toBe("ready");
    expect(result.current.triggerReached).toBe(true);
  });

  it("clearing the gesture via upward drag resets state so a fresh pull starts in pulling", () => {
    const { result } = renderHook(() => usePullToRefresh(vi.fn()));

    act(() => {
      result.current.containerProps.onPointerDown(pointerEvent({ clientY: 0 }));
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 300 }));
    });
    expect(result.current.state).toBe("ready");

    // Upward drag (negative dy relative to start) cancels the commit — the
    // user is scrolling, not refreshing. After this a subsequent downward
    // pull must start fresh in "pulling".
    act(() => {
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: -10 }));
    });
    expect(result.current.state).toBe("idle");
    expect(result.current.triggerReached).toBe(false);

    act(() => {
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 40 }));
    });
    expect(result.current.state).toBe("pulling");
    expect(result.current.triggerReached).toBe(false);
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

  it("exposes touchAction 'pan-y' so the browser only consults vertical pans for native gestures", () => {
    const { result } = renderHook(() => usePullToRefresh(vi.fn()));
    expect(result.current.containerProps.style).toEqual({ touchAction: "pan-y" });
  });

  it("preventDefaults the first downward move so iOS Safari's native PTR can't claim the gesture", () => {
    const { result } = renderHook(() => usePullToRefresh(vi.fn()));
    const preventDefault = vi.fn();
    act(() => {
      result.current.containerProps.onPointerDown(pointerEvent({ clientY: 0 }));
      // 30px is well below the 72px trigger — the point of this test is that
      // suppression starts at gesture activation, not at commit. Anything else
      // leaves a window where the native rubber-band wins.
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 30, preventDefault }));
    });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("skips preventDefault when the underlying event is not cancelable", () => {
    const { result } = renderHook(() => usePullToRefresh(vi.fn()));
    const preventDefault = vi.fn();
    act(() => {
      result.current.containerProps.onPointerDown(pointerEvent({ clientY: 0 }));
      // Passive listeners and our jsdom test events both report
      // cancelable=false. Calling preventDefault would either throw or
      // log a console warning; the guard keeps the hook quiet.
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 30, cancelable: false, preventDefault }));
    });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("does not preventDefault upward moves so the page can still scroll after a partial pull", () => {
    const { result } = renderHook(() => usePullToRefresh(vi.fn()));
    const preventDefault = vi.fn();
    act(() => {
      result.current.containerProps.onPointerDown(pointerEvent({ clientY: 100 }));
      // dy is negative — user is reversing direction to scroll. Letting the
      // browser handle this is the whole point of the dy<=0 early-return.
      result.current.containerProps.onPointerMove(pointerEvent({ clientY: 50, preventDefault }));
    });
    expect(preventDefault).not.toHaveBeenCalled();
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
