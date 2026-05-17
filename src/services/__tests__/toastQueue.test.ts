import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  enqueue,
  dismiss,
  subscribe,
  suppressNextBatch,
  __resetForTest,
  __getStateForTest,
  type QueuedToast,
} from "../toastQueue";

describe("toastQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetForTest();
  });

  afterEach(() => {
    __resetForTest();
    vi.useRealTimers();
  });

  function tick(ms: number) {
    vi.advanceTimersByTime(ms);
  }

  /** Enqueue + flush a sequence of toasts so each is dispatched into its
   *  own coalesce window. Centralised to satisfy the test-duplication gate
   *  (the bare enqueue/tick pattern repeats across multiple cases). */
  function enqueueAndFlushEach(toasts: ReadonlyArray<{ id: string; message: string }>) {
    for (const t of toasts) {
      enqueue(t);
      tick(50);
    }
  }

  it("displays a single enqueued toast after the coalesce window flushes", () => {
    const seen: QueuedToast[][] = [];
    subscribe((v) => seen.push([...v]));

    enqueue({ id: "a", message: "Hello", kind: "info" });
    expect(__getStateForTest().visible.length).toBe(0);

    tick(50);
    expect(__getStateForTest().visible.map((t) => t.id)).toEqual(["a"]);
    expect(seen[seen.length - 1].map((t) => t.message)).toEqual(["Hello"]);
  });

  it("two simultaneous enqueues coalesce into one mega-toast", () => {
    enqueue({ id: "a", message: "+100 XP", kind: "xp" });
    enqueue({ id: "b", message: "Lvl 2", kind: "level" });
    tick(50);
    const v = __getStateForTest().visible;
    expect(v.length).toBe(1);
    expect(v[0].message).toBe("+100 XP, Lvl 2");
    // Coalesced toast inherits the first buffered id so callers can dismiss it.
    expect(v[0].id).toBe("a");
  });

  it("a third toast outside the coalesce window queues after the cap", () => {
    enqueueAndFlushEach([
      { id: "a", message: "First" },
      { id: "b", message: "Second" },
      { id: "c", message: "Third" },
    ]);
    const state = __getStateForTest();
    expect(state.visible.map((t) => t.id)).toEqual(["a", "b"]);
    expect(state.pendingCount).toBe(1);
  });

  it("dismissing a visible toast promotes the next pending toast after the inter-display delay", () => {
    enqueueAndFlushEach([
      { id: "a", message: "First" },
      { id: "b", message: "Second" },
      { id: "c", message: "Third" },
    ]);
    expect(__getStateForTest().pendingCount).toBe(1);

    dismiss("a");
    // Drain re-fires immediately on dismiss; the inter-display timer arms the
    // *following* drain pass for any further pending entries.
    expect(__getStateForTest().visible.map((t) => t.id)).toEqual(["b", "c"]);
    expect(__getStateForTest().pendingCount).toBe(0);
  });

  it("queues the next pending toast and re-arms after the 500ms inter-display delay", () => {
    enqueueAndFlushEach([
      { id: "a", message: "First" },
      { id: "b", message: "Second" },
      { id: "c", message: "Third" },
      { id: "d", message: "Fourth" },
    ]);

    expect(__getStateForTest().visible.map((t) => t.id)).toEqual(["a", "b"]);
    expect(__getStateForTest().pendingCount).toBe(2);

    dismiss("a");
    expect(__getStateForTest().visible.map((t) => t.id)).toEqual(["b", "c"]);
    // d still pending — drain timer waits 500ms before another auto-promotion.
    expect(__getStateForTest().pendingCount).toBe(1);

    // After the delay the queue is still respecting the visible cap of 2,
    // so d only promotes when something else dismisses.
    tick(500);
    expect(__getStateForTest().pendingCount).toBe(1);

    dismiss("b");
    expect(__getStateForTest().visible.map((t) => t.id)).toEqual(["c", "d"]);
    expect(__getStateForTest().pendingCount).toBe(0);
  });

  it("dismiss() with an unknown id is a no-op", () => {
    enqueue({ id: "a", message: "First" });
    tick(50);
    const before = __getStateForTest().visible;
    dismiss("does-not-exist");
    expect(__getStateForTest().visible).toEqual(before);
  });

  it("suppressNextBatch() drops enqueues during the suppression window", () => {
    suppressNextBatch();
    enqueue({ id: "a", message: "Suppressed" });
    enqueue({ id: "b", message: "Also suppressed" });
    tick(50);
    expect(__getStateForTest().visible.length).toBe(0);
    expect(__getStateForTest().pendingCount).toBe(0);
  });

  it("suppression expires so subsequent enqueues display normally", () => {
    suppressNextBatch();
    enqueue({ id: "a", message: "Drop" });
    tick(250); // suppression window expires
    enqueue({ id: "b", message: "Pass" });
    tick(50);
    expect(__getStateForTest().visible.map((t) => t.message)).toEqual(["Pass"]);
  });

  it("__resetForTest clears any in-flight coalesce timer (paranoia branch)", () => {
    enqueue({ id: "a", message: "Will be cancelled" });
    // Don't tick — coalesce timer is still scheduled.
    expect(__getStateForTest().coalesceBufferCount).toBe(1);
    __resetForTest();
    expect(__getStateForTest().coalesceBufferCount).toBe(0);
    // Advancing time after reset must not surface the cancelled toast.
    tick(50);
    expect(__getStateForTest().visible.length).toBe(0);
  });

  it("subscribe() invokes listener with the current snapshot synchronously and on every change", () => {
    enqueue({ id: "a", message: "First" });
    tick(50);

    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].map((t: QueuedToast) => t.id)).toEqual(["a"]);

    enqueue({ id: "b", message: "Second" });
    tick(50);
    expect(listener.mock.calls.length).toBeGreaterThan(1);

    unsubscribe();
    enqueue({ id: "c", message: "Third" });
    tick(50);
    // After unsubscribe, listener must not be invoked further.
    const callsAfterUnsub = listener.mock.calls.length;
    enqueue({ id: "d", message: "Fourth" });
    tick(50);
    expect(listener.mock.calls.length).toBe(callsAfterUnsub);
  });
});
