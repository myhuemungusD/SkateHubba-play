import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useNativeViewfinder } from "../useNativeViewfinder";

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) };
}

/** A viewfinder two levels deep, at the given on-screen position. */
function mountViewfinder(top: number, bottom: number) {
  const outer = document.createElement("div");
  const inner = document.createElement("div");
  const viewfinder = document.createElement("div");
  inner.appendChild(viewfinder);
  outer.appendChild(inner);
  document.body.appendChild(outer);
  viewfinder.getBoundingClientRect = () => rect(top, bottom);
  const scroll = vi.fn();
  viewfinder.scrollIntoView = scroll;
  return { outer, inner, viewfinder, scroll, ref: { current: viewfinder } };
}

function addDock(top: number) {
  const dock = document.createElement("div");
  dock.className = "action-dock";
  dock.getBoundingClientRect = () => rect(top, window.innerHeight);
  document.body.appendChild(dock);
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useNativeViewfinder", () => {
  it("does nothing while the native camera is off", () => {
    const v = mountViewfinder(900, 1200);
    renderHook(() => useNativeViewfinder(v.ref, false));
    expect(v.inner.classList.contains("sh-native-cam")).toBe(false);
    expect(v.scroll).not.toHaveBeenCalled();
  });

  it("does nothing without a mounted viewfinder", () => {
    expect(() => renderHook(() => useNativeViewfinder({ current: null }, true))).not.toThrow();
  });

  it("marks every ancestor see-through while live and unmarks on stop", () => {
    const v = mountViewfinder(100, 400);
    const view = renderHook(({ live }) => useNativeViewfinder(v.ref, live), { initialProps: { live: true } });
    expect(v.inner.classList.contains("sh-native-cam")).toBe(true);
    expect(v.outer.classList.contains("sh-native-cam")).toBe(true);
    expect(document.body.classList.contains("sh-native-cam")).toBe(true);
    expect(v.viewfinder.classList.contains("sh-native-cam")).toBe(false);
    view.rerender({ live: false });
    expect(v.outer.classList.contains("sh-native-cam")).toBe(false);
    expect(document.body.classList.contains("sh-native-cam")).toBe(false);
  });

  it("leaves an already-visible viewfinder where it is", () => {
    const v = mountViewfinder(100, 400);
    addDock(600);
    renderHook(() => useNativeViewfinder(v.ref, true));
    expect(v.scroll).not.toHaveBeenCalled();
  });

  it("scrolls a viewfinder hidden under the action dock clear of it (small phone)", () => {
    // 375x667: the matcher's setter clip pushes the 367px viewfinder below the fold.
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(667);
    const v = mountViewfinder(700, 1067);
    addDock(540);
    addDock(560);
    renderHook(() => useNativeViewfinder(v.ref, true));
    expect(v.viewfinder.style.scrollMarginBottom).toBe(`${667 - 540 + 12}px`);
    expect(v.scroll).toHaveBeenCalledWith({ block: "end", behavior: "smooth" });
    vi.restoreAllMocks();
  });

  it("scrolls a viewfinder that sits partly above the top back down", () => {
    const v = mountViewfinder(-50, 300);
    renderHook(() => useNativeViewfinder(v.ref, true));
    expect(v.viewfinder.style.scrollMarginBottom).toBe("12px");
    expect(v.scroll).toHaveBeenCalledTimes(1);
  });

  it("survives a web view without scrollIntoView", () => {
    const v = mountViewfinder(900, 1200);
    Object.defineProperty(v.viewfinder, "scrollIntoView", { value: undefined });
    expect(() => renderHook(() => useNativeViewfinder(v.ref, true))).not.toThrow();
  });
});
