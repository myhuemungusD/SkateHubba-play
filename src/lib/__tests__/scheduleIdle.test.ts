import { afterEach, describe, expect, it, vi } from "vitest";
import { runAfterQuiet, scheduleIdle } from "../scheduleIdle";

afterEach(() => {
  vi.useRealTimers();
  delete (window as { requestIdleCallback?: unknown }).requestIdleCallback;
});

describe("scheduleIdle", () => {
  it("uses requestIdleCallback when the browser has it", () => {
    const ric = vi.fn((cb: () => void) => {
      cb();
      return 1;
    });
    window.requestIdleCallback = ric as unknown as typeof window.requestIdleCallback;
    const task = vi.fn();
    scheduleIdle(task, 50);
    expect(task).toHaveBeenCalledOnce();
    expect(ric).toHaveBeenCalledWith(expect.any(Function), { timeout: 50 });
  });

  it("falls back to a timeout", () => {
    vi.useFakeTimers();
    const task = vi.fn();
    scheduleIdle(task, 25);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(25);
    expect(task).toHaveBeenCalledOnce();
  });

  it("waits out the quiet period after load", () => {
    vi.useFakeTimers();
    window.requestIdleCallback = ((cb: () => void) => {
      cb();
      return 1;
    }) as unknown as typeof window.requestIdleCallback;
    const task = vi.fn();
    runAfterQuiet(task);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(task).toHaveBeenCalledOnce();
  });

  it("waits for the load event when the document is still loading", () => {
    vi.useFakeTimers();
    const original = Object.getOwnPropertyDescriptor(document, "readyState");
    Object.defineProperty(document, "readyState", { configurable: true, get: () => "loading" });
    window.requestIdleCallback = ((cb: () => void) => {
      cb();
      return 1;
    }) as unknown as typeof window.requestIdleCallback;
    const task = vi.fn();
    try {
      runAfterQuiet(task);
      window.dispatchEvent(new Event("load"));
      expect(task).not.toHaveBeenCalled();
      vi.advanceTimersByTime(10_000);
      expect(task).toHaveBeenCalledOnce();
    } finally {
      if (original) Object.defineProperty(document, "readyState", original);
    }
  });
});
