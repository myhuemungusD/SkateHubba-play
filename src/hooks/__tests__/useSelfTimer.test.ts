import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { SELF_TIMER_SECONDS, useSelfTimer } from "../useSelfTimer";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useSelfTimer", () => {
  it("is off by default and fires straight away", () => {
    const { result } = renderHook(() => useSelfTimer());
    const fire = vi.fn();
    expect(result.current.enabled).toBe(false);
    act(() => result.current.start(fire));
    expect(fire).toHaveBeenCalledTimes(1);
    expect(result.current.countdown).toBeNull();
  });

  it("counts 3-2-1 before firing when on", () => {
    const { result } = renderHook(() => useSelfTimer());
    const fire = vi.fn();
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(true);
    act(() => result.current.start(fire));
    expect(result.current.countdown).toBe(SELF_TIMER_SECONDS);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.countdown).toBe(2);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.countdown).toBe(1);
    expect(fire).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(fire).toHaveBeenCalledTimes(1);
    expect(result.current.countdown).toBeNull();
  });

  it("cancel stops the countdown without firing", () => {
    const { result } = renderHook(() => useSelfTimer());
    const fire = vi.fn();
    act(() => result.current.toggle());
    act(() => result.current.start(fire));
    act(() => result.current.cancel());
    act(() => vi.advanceTimersByTime(5000));
    expect(fire).not.toHaveBeenCalled();
    expect(result.current.countdown).toBeNull();
  });

  it("never fires after unmount", () => {
    const { result, unmount } = renderHook(() => useSelfTimer());
    const fire = vi.fn();
    act(() => result.current.toggle());
    act(() => result.current.start(fire));
    unmount();
    vi.advanceTimersByTime(5000);
    expect(fire).not.toHaveBeenCalled();
  });
});
