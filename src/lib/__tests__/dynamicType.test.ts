import { afterEach, describe, expect, it, vi } from "vitest";
import { installDynamicType, rootFontSizeFor } from "../dynamicType";

describe("rootFontSizeFor", () => {
  it("keeps 16px at the iOS default body size", () => {
    expect(rootFontSizeFor(17)).toBe(16);
  });
  it("scales up with larger text sizes but never below the default", () => {
    expect(rootFontSizeFor(19)).toBeCloseTo(17.88, 2);
    expect(rootFontSizeFor(15)).toBe(16);
  });
  it("clamps accessibility sizes and junk values", () => {
    expect(rootFontSizeFor(53)).toBe(24);
    expect(rootFontSizeFor(5)).toBe(16);
    expect(rootFontSizeFor(Number.NaN)).toBe(16);
    expect(rootFontSizeFor(0)).toBe(16);
  });
});

describe("installDynamicType", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty("font-size");
  });

  const fakeBody = (px: string) =>
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ fontSize: px } as CSSStyleDeclaration);

  it("does nothing off native iOS", () => {
    const spy = fakeBody("20px");
    const teardown = installDynamicType(window, () => "web");
    expect(document.documentElement.style.fontSize).toBe("");
    expect(spy).not.toHaveBeenCalled();
    teardown();
  });

  it("sets the root size on iOS and re-measures on foreground", () => {
    fakeBody("20px");
    const teardown = installDynamicType(window, () => "ios");
    expect(document.documentElement.style.fontSize).toBe("18.82px");

    fakeBody("17px");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.documentElement.style.fontSize).toBe("");

    teardown();
    fakeBody("20px");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.documentElement.style.fontSize).toBe("");
  });

  it("skips measuring while the page is hidden", () => {
    const spy = fakeBody("20px");
    const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const teardown = installDynamicType(window, () => "ios");
    expect(spy).not.toHaveBeenCalled();
    vis.mockRestore();
    teardown();
  });

  it("falls back to 16px when the document has no window to measure with", () => {
    // A detached document (no defaultView) can't compute styles; the probe
    // reads as NaN and the root size must stay at the default.
    const doc = document.implementation.createHTMLDocument("detached");
    expect(doc.defaultView).toBeNull();
    doc.documentElement.style.fontSize = "30px";
    const teardown = installDynamicType({ document: doc } as unknown as Window, () => "ios");
    expect(doc.documentElement.style.fontSize).toBe("");
    expect(doc.body.children).toHaveLength(0); // the probe is cleaned up
    teardown();
  });

  it("uses Capacitor's platform by default", () => {
    const teardown = installDynamicType();
    expect(document.documentElement.style.fontSize).toBe("");
    teardown();
  });
});
