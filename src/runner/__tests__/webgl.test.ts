import { describe, expect, it, vi } from "vitest";
import { canUseWebGL, frameDelta, noteFps } from "../webgl";

describe("webgl helpers", () => {
  it("reports whether a context can be created", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(canUseWebGL()).toBe(false);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) =>
      kind === "webgl" ? ({} as WebGLRenderingContext) : null) as typeof HTMLCanvasElement.prototype.getContext);
    expect(canUseWebGL()).toBe(true);
    vi.restoreAllMocks();
  });

  it("caps a frame slice and ignores a clock that went backwards", () => {
    expect(frameDelta(1000, 0)).toBe(0.1);
    expect(frameDelta(20, 0)).toBe(0.02);
    expect(frameDelta(0, 10)).toBe(0);
    expect(frameDelta(Number.NaN, 0)).toBe(0);
  });

  it("writes fps after half a second", () => {
    const el = document.createElement("span");
    const bucket = { frames: 0, stamp: 0 };
    noteFps(el, bucket, 1000);
    expect(el.textContent).toBe("");
    noteFps(el, bucket, 1600);
    expect(el.textContent).toBe("3");
    noteFps(null, { frames: 0, stamp: 0 }, 1000);
  });
});
