import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpotlightOverlay } from "../SpotlightOverlay";

afterEach(() => {
  document.body.innerHTML = "";
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

function mountMain(): HTMLElement {
  const main = document.createElement("main");
  main.id = "main-content";
  document.body.appendChild(main);
  return main;
}

function renderOverlay(props: { targetSelector?: string; reducedMotion?: boolean } = {}) {
  return render(
    <SpotlightOverlay targetSelector={props.targetSelector} reducedMotion={props.reducedMotion ?? false}>
      <div>tutorial body</div>
    </SpotlightOverlay>,
  );
}

describe("SpotlightOverlay", () => {
  it("renders the dim backdrop and centered children when no targetSelector is provided", () => {
    renderOverlay();
    expect(screen.getByTestId("spotlight-overlay")).toBeInTheDocument();
    expect(screen.getByText("tutorial body")).toBeInTheDocument();
    expect(screen.queryByTestId("spotlight-cutout")).toBeNull();
  });

  it("computes and renders the cutout rect when targetSelector resolves", () => {
    mountTarget("challenge-cta", { top: 100, left: 50, width: 200, height: 60 });
    renderOverlay({ targetSelector: '[data-tutorial="challenge-cta"]' });
    const cutout = screen.getByTestId("spotlight-cutout") as HTMLElement;
    // 8px padding is added on every side, see PADDING constant in source
    expect(cutout.style.top).toBe("92px");
    expect(cutout.style.left).toBe("42px");
    expect(cutout.style.width).toBe("216px");
    expect(cutout.style.height).toBe("76px");
  });

  it("falls back to the plain dim backdrop when the selector matches an element with zero size", () => {
    mountTarget("ghost", { top: 0, left: 0, width: 0, height: 0 });
    renderOverlay({ targetSelector: '[data-tutorial="ghost"]' });
    expect(screen.queryByTestId("spotlight-cutout")).toBeNull();
  });

  it("falls back when selector matches nothing", () => {
    renderOverlay({ targetSelector: '[data-tutorial="missing"]' });
    expect(screen.queryByTestId("spotlight-cutout")).toBeNull();
  });

  it("sets inert on #main-content while mounted and removes it on unmount", () => {
    const main = mountMain();
    expect(main.hasAttribute("inert")).toBe(false);
    const { unmount } = renderOverlay();
    expect(main.hasAttribute("inert")).toBe(true);
    unmount();
    expect(main.hasAttribute("inert")).toBe(false);
  });

  it("preserves a pre-existing inert attribute on #main-content across unmount", () => {
    const main = mountMain();
    main.setAttribute("inert", "");
    const { unmount } = renderOverlay();
    expect(main.hasAttribute("inert")).toBe(true);
    unmount();
    expect(main.hasAttribute("inert")).toBe(true);
  });

  it("does nothing inert-wise when #main-content is not present in the DOM", () => {
    const { unmount } = renderOverlay();
    // Should mount + unmount without throwing
    expect(() => unmount()).not.toThrow();
  });

  it("registers and cleans up resize/scroll listeners", () => {
    mountTarget("x", { top: 0, left: 0, width: 10, height: 10 });
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderOverlay({ targetSelector: '[data-tutorial="x"]' });
    expect(addSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("scroll", expect.any(Function), expect.objectContaining({ capture: true }));

    unmount();
    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function), expect.objectContaining({ capture: true }));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("drops the pulsing ring animation class when reducedMotion=true", () => {
    mountTarget("z", { top: 0, left: 0, width: 10, height: 10 });
    const { container } = renderOverlay({ targetSelector: '[data-tutorial="z"]', reducedMotion: true });
    const rings = container.querySelectorAll("div.border-brand-orange");
    expect(rings.length).toBe(1);
    expect(rings[0].className).not.toContain("animate-pulse");
  });
});
