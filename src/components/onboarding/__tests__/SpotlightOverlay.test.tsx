import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  document.body.innerHTML = "";
});

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
    mountTarget("ghost", { top: 0, left: 0, width: 0, height: 0 });
    renderOverlay({ targetSelector: '[data-tutorial="ghost"]' });
    expect(screen.queryByTestId("spotlight-cutout")).toBeNull();
  });

  it("does NOT paint a highlight when selector matches nothing", () => {
    renderOverlay({ targetSelector: '[data-tutorial="missing"]' });
    expect(screen.queryByTestId("spotlight-cutout")).toBeNull();
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

  it("fires onAnchorMissing immediately when the target selector matches no element", () => {
    const onAnchorMissing = vi.fn();
    renderOverlay({ targetSelector: '[data-tutorial="never-mounted"]', onAnchorMissing });
    expect(onAnchorMissing).toHaveBeenCalledTimes(1);
  });

  it("fires onAnchorMissing after the watchdog window when the target never intersects", async () => {
    vi.useFakeTimers();
    mountTarget("offscreen", { top: 0, left: 0, width: 10, height: 10 });
    // IO never reports an intersection.
    installIO(() => ({
      observe: () => undefined,
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
});
