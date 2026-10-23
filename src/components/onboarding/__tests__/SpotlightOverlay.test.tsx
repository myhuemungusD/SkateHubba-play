import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SpotlightOverlay, readSafeTop, resolvePlacement, SPOTLIGHT_CLIP_CLASS } from "../SpotlightOverlay";

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

/**
 * Regression: the feed camera sits flush under the status bar, so the ring
 * (8px padding) and its 32px orange glow painted up behind the Dynamic Island
 * as a stray orange arc. The ring is clamped and clipped to the safe area.
 */
describe("SpotlightOverlay safe area", () => {
  function stubSafeTop(px: number) {
    const real = window.getComputedStyle;
    return vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
      const style = real(el, pseudo);
      if (el.classList.contains("pt-safe-inset")) {
        return { ...style, paddingTop: `${px}px` } as CSSStyleDeclaration;
      }
      return style;
    });
  }

  it("reads the top inset through the pt-safe-inset probe and leaves no probe behind", () => {
    const spy = stubSafeTop(62);
    expect(readSafeTop()).toBe(62);
    expect(document.querySelector(".pt-safe-inset")).toBeNull();
    spy.mockRestore();
    expect(readSafeTop()).toBe(0);
  });

  it("clamps the ring's top edge to the safe area while keeping its bottom edge", async () => {
    const spy = stubSafeTop(62);
    try {
      // 6.9" geometry measured in the before shots: camera 65-109px, inset 62px.
      mountTarget("feed-camera", { top: 65, left: 265, width: 44, height: 44 });
      renderOverlay({ targetSelector: '[data-tutorial="feed-camera"]' });
      const cutout = (await screen.findByTestId("spotlight-cutout")) as HTMLElement;
      expect(cutout.style.top).toBe("62px");
      expect(cutout.style.height).toBe("55px"); // 109 + 8 - 62
      expect(screen.getByTestId("spotlight-clip").className).toBe(SPOTLIGHT_CLIP_CLASS);
      expect(SPOTLIGHT_CLIP_CLASS).toContain("clip-path:inset(env(safe-area-inset-top");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("resolvePlacement", () => {
  const rect = (top: number, height = 40) => ({ top, left: 0, width: 40, height });
  it("keeps the requested dock without a ring or a viewport", () => {
    expect(resolvePlacement("bottom", null, 800)).toBe("bottom");
    expect(resolvePlacement("top", rect(700), 0)).toBe("top");
  });
  it("moves a bottom bubble up when its target is in the lower half, and the reverse", () => {
    expect(resolvePlacement("bottom", rect(100), 800)).toBe("bottom");
    expect(resolvePlacement("bottom", rect(600), 800)).toBe("top");
    expect(resolvePlacement("top", rect(600), 800)).toBe("top");
    expect(resolvePlacement("top", rect(100), 800)).toBe("bottom");
  });

  it("docks the bubble at the top when the ring target is low on screen", async () => {
    mountTarget("spot-passport", { top: 600, left: 16, width: 300, height: 100 });
    renderOverlay({ targetSelector: '[data-tutorial="spot-passport"]' });
    await screen.findByTestId("spotlight-cutout");
    expect(screen.getByText("tutorial body").closest("[data-coach-dock]")).toHaveAttribute("data-coach-dock", "top");
  });

  it("docks at the bottom with the consent-aware hook class by default", () => {
    renderOverlay();
    const dock = screen.getByText("tutorial body").closest("[data-coach-dock]");
    expect(dock).toHaveAttribute("data-coach-dock", "bottom");
    expect(dock).toHaveClass("coach-dock-bottom");
    expect(dock?.firstElementChild).toHaveClass("coach-dock-bubble");
  });
});
