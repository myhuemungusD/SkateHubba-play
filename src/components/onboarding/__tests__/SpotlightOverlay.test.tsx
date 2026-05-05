import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function renderOverlay(props: { targetSelector?: string; reducedMotion?: boolean; onBackdropTap?: () => void } = {}) {
  return render(
    <SpotlightOverlay
      targetSelector={props.targetSelector}
      reducedMotion={props.reducedMotion ?? false}
      onBackdropTap={props.onBackdropTap}
    >
      <div data-testid="mascot-bubble">tutorial body</div>
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
    // The initial measurement is rAF-deferred to keep setState off the
    // synchronous effect path — wait for the next frame before asserting.
    const cutout = (await screen.findByTestId("spotlight-cutout")) as HTMLElement;
    // 8px padding is added on every side, see PADDING constant in source
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

  it("invokes onBackdropTap when the user clicks outside the bubble and target", async () => {
    const onBackdropTap = vi.fn();
    renderOverlay({ onBackdropTap });
    // Click on a stray element outside the bubble.
    const stray = document.createElement("button");
    stray.textContent = "stray";
    document.body.appendChild(stray);
    await userEvent.click(stray);
    expect(onBackdropTap).toHaveBeenCalledTimes(1);
  });

  it("does NOT invoke onBackdropTap when the user clicks inside the bubble", async () => {
    const onBackdropTap = vi.fn();
    renderOverlay({ onBackdropTap });
    await userEvent.click(screen.getByTestId("mascot-bubble"));
    expect(onBackdropTap).not.toHaveBeenCalled();
  });

  it("does NOT invoke onBackdropTap when the user clicks the highlighted target itself", async () => {
    const target = mountTarget("zone", { top: 0, left: 0, width: 50, height: 50 });
    const onBackdropTap = vi.fn();
    renderOverlay({ targetSelector: '[data-tutorial="zone"]', onBackdropTap });
    await userEvent.click(target);
    expect(onBackdropTap).not.toHaveBeenCalled();
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

  it("drops the pulsing ring animation class when reducedMotion=true", async () => {
    mountTarget("z", { top: 0, left: 0, width: 10, height: 10 });
    const { container } = renderOverlay({ targetSelector: '[data-tutorial="z"]', reducedMotion: true });
    // Initial measurement is rAF-deferred — wait for the ring to mount.
    await waitFor(() => {
      expect(container.querySelectorAll("div.border-brand-orange").length).toBe(1);
    });
    const rings = container.querySelectorAll("div.border-brand-orange");
    expect(rings[0].className).not.toContain("animate-pulse");
  });
});
