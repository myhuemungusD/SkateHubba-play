import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { SpotlightOverlay } from "../SpotlightOverlay";

/**
 * IntersectionObserver is not implemented in jsdom. Tests that exercise the
 * anchor-missing watchdog supply their own controllable stub via the helper
 * below; the rest of the suite uses a no-op stub so component mount succeeds.
 */
type IOInstance = {
  observe: (el: Element) => void;
  unobserve: () => void;
  disconnect: () => void;
};
type IOFactory = (cb: IntersectionObserverCallback) => IOInstance;
const installIO = (factory: IOFactory) => {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = function (
    cb: IntersectionObserverCallback,
  ) {
    return factory(cb);
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/**
 * Queue animation frames instead of letting jsdom run them on its own clock,
 * so a test decides exactly when the overlay's rAF-deferred measurement and
 * retry run. Without this, whether those frames fire before a synchronous test
 * ends depends on machine speed, and so does the file's branch coverage.
 */
function captureFrames() {
  const frames: FrameRequestCallback[] = [];
  const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  const flush = () =>
    act(() => {
      for (const cb of frames.splice(0)) cb(0);
    });
  return { raf, flush };
}

beforeEach(() => {
  installIO(() => ({
    observe: () => undefined,
    unobserve: () => undefined,
    disconnect: () => undefined,
  }));
});

function mountTarget(selectorAttr: string, rect: { top: number; left: number; width: number; height: number }) {
  const el = document.createElement("div");
  el.setAttribute("data-tutorial", selectorAttr);
  document.body.appendChild(el);
  el.getBoundingClientRect = vi.fn().mockReturnValue({
    ...rect,
    bottom: rect.top + rect.height,
    right: rect.left + rect.width,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect);
  return el;
}

function renderOverlay(props: { targetSelector?: string; reducedMotion?: boolean; onAnchorMissing?: () => void } = {}) {
  return render(
    <SpotlightOverlay
      targetSelector={props.targetSelector}
      reducedMotion={props.reducedMotion ?? false}
      onAnchorMissing={props.onAnchorMissing}
    >
      <div data-testid="mascot-bubble" data-coach-bubble="">
        tutorial body
      </div>
    </SpotlightOverlay>,
  );
}

describe("SpotlightOverlay", () => {
  it("renders the overlay frame and bubble children with no ring when no target is given", () => {
    renderOverlay();
    expect(screen.getByTestId("spotlight-overlay")).toBeInTheDocument();
    expect(screen.getByText("tutorial body")).toBeInTheDocument();
    expect(screen.queryByTestId("spotlight-cutout")).toBeNull();
  });

  it("computes and renders the highlight rect when targetSelector resolves", async () => {
    mountTarget("challenge-cta", { top: 100, left: 50, width: 200, height: 60 });
    renderOverlay({ targetSelector: '[data-tutorial="challenge-cta"]' });
    const cutout = (await screen.findByTestId("spotlight-cutout")) as HTMLElement;
    expect(cutout.style.top).toBe("92px");
    expect(cutout.style.left).toBe("42px");
    expect(cutout.style.width).toBe("216px");
    expect(cutout.style.height).toBe("76px");
  });

  it("does NOT paint a highlight when the selector matches an element with zero size", () => {
    const { flush } = captureFrames();
    mountTarget("ghost", { top: 0, left: 0, width: 0, height: 0 });
    renderOverlay({ targetSelector: '[data-tutorial="ghost"]' });
    flush();
    expect(screen.queryByTestId("spotlight-cutout")).toBeNull();
  });

  it("paints a highlight for a zero-width element that still has height", () => {
    const { flush } = captureFrames();
    mountTarget("rule", { top: 10, left: 20, width: 0, height: 30 });
    renderOverlay({ targetSelector: '[data-tutorial="rule"]' });
    flush();
    const cutout = screen.getByTestId("spotlight-cutout");
    expect(cutout.style.width).toBe("16px");
    expect(cutout.style.height).toBe("46px");
  });

  it("does NOT paint a highlight when selector matches nothing", () => {
    const { flush } = captureFrames();
    renderOverlay({ targetSelector: '[data-tutorial="missing"]' });
    flush();
    expect(screen.queryByTestId("spotlight-cutout")).toBeNull();
  });

  it("measures once per frame however many scroll and resize events arrive", () => {
    const { raf, flush } = captureFrames();
    mountTarget("busy", { top: 0, left: 0, width: 10, height: 10 });
    renderOverlay({ targetSelector: '[data-tutorial="busy"]' });
    const framesAfterMount = raf.mock.calls.length;
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    expect(raf.mock.calls.length).toBe(framesAfterMount);
    flush();
    window.dispatchEvent(new Event("scroll"));
    expect(raf.mock.calls.length).toBe(framesAfterMount + 1);
  });

  it("is non-blocking (pointer-events none on the root frame so the page stays interactive)", () => {
    renderOverlay();
    const overlay = screen.getByTestId("spotlight-overlay");
    expect(overlay.className).toContain("pointer-events-none");
  });

  it("registers and cleans up resize/scroll listeners with matching options", () => {
    mountTarget("x", { top: 0, left: 0, width: 10, height: 10 });
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderOverlay({ targetSelector: '[data-tutorial="x"]' });
    // Capture the exact options object passed to addEventListener so we can
    // assert removeEventListener received the same reference (browsers match
    // listeners by `capture` flag — a mismatch leaks the listener).
    const addedScroll = addSpy.mock.calls.find(([type]) => type === "scroll");
    expect(addedScroll).toBeDefined();
    const addedOptions = addedScroll?.[2];
    expect(addedOptions).toEqual(expect.objectContaining({ capture: true, passive: true }));

    unmount();
    const removedScroll = removeSpy.mock.calls.find(([type]) => type === "scroll");
    expect(removedScroll?.[2]).toBe(addedOptions);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("drops the pulsing ring animation class when reducedMotion=true", async () => {
    mountTarget("z", { top: 0, left: 0, width: 10, height: 10 });
    const { container } = renderOverlay({ targetSelector: '[data-tutorial="z"]', reducedMotion: true });
    await waitFor(() => {
      expect(container.querySelectorAll("div.border-brand-orange").length).toBe(1);
    });
    const rings = container.querySelectorAll("div.border-brand-orange");
    expect(rings[0].className).not.toContain("animate-pulse");
  });

  it("fires onAnchorMissing after the timeout when the target selector matches no element", async () => {
    vi.useFakeTimers();
    const onAnchorMissing = vi.fn();
    renderOverlay({ targetSelector: '[data-tutorial="never-mounted"]', onAnchorMissing });
    expect(onAnchorMissing).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(onAnchorMissing).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("fires onAnchorMissing after the watchdog window when the target never intersects", async () => {
    vi.useFakeTimers();
    mountTarget("offscreen", { top: 0, left: 0, width: 10, height: 10 });
    // IO only ever reports the target as outside the viewport.
    installIO((cb) => ({
      observe: (el) => {
        cb([{ isIntersecting: false, target: el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
      },
      unobserve: () => undefined,
      disconnect: () => undefined,
    }));
    const onAnchorMissing = vi.fn();
    renderOverlay({ targetSelector: '[data-tutorial="offscreen"]', onAnchorMissing });
    expect(onAnchorMissing).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(onAnchorMissing).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("does NOT fire onAnchorMissing when the target intersects within the window", async () => {
    vi.useFakeTimers();
    mountTarget("visible", { top: 0, left: 0, width: 10, height: 10 });
    installIO((cb) => ({
      observe: (el) => {
        // Synchronously fire an intersection — the watchdog should disarm.
        cb([{ isIntersecting: true, target: el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
      },
      unobserve: () => undefined,
      disconnect: () => undefined,
    }));
    const onAnchorMissing = vi.fn();
    renderOverlay({ targetSelector: '[data-tutorial="visible"]', onAnchorMissing });
    vi.advanceTimersByTime(2000);
    expect(onAnchorMissing).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  describe("when the target mounts after the overlay", () => {
    function renderBeforeTarget(isIntersecting: boolean) {
      vi.useFakeTimers();
      const { flush } = captureFrames();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      installIO((cb) => ({
        observe: (el) => {
          cb([{ isIntersecting, target: el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
        },
        unobserve: () => undefined,
        disconnect: () => undefined,
      }));
      const onAnchorMissing = vi.fn();
      renderOverlay({ targetSelector: '[data-tutorial="late"]', onAnchorMissing });
      mountTarget("late", { top: 0, left: 0, width: 10, height: 10 });
      flush();
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      return { onAnchorMissing, warn };
    }

    it("stays quiet when the retried observer sees it intersect", () => {
      const { onAnchorMissing, warn } = renderBeforeTarget(true);
      expect(onAnchorMissing).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    it("reports no-intersect, not no-element, when it never comes into view", () => {
      const { onAnchorMissing, warn } = renderBeforeTarget(false);
      expect(onAnchorMissing).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith("[WARN]", "tutorial_step_anchor_missing", {
        reason: "no-intersect",
        selector: '[data-tutorial="late"]',
      });
    });
  });
});

describe("SpotlightOverlay placement", () => {
  it("pins the bubble to the top when asked", () => {
    const { getByText } = render(
      <SpotlightOverlay reducedMotion placement="top">
        <p>hi</p>
      </SpotlightOverlay>,
    );
    expect(getByText("hi").parentElement?.className).toContain("mt-16");
  });
});
