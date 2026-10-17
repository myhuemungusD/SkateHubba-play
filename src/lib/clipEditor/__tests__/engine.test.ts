import { afterEach, describe, expect, it, vi } from "vitest";
import { drawCaption, drawTapeStamp, pickMime, EditorEngine } from "../engine";
import { createProject } from "../project";

afterEach(() => vi.unstubAllGlobals());

describe("pickMime", () => {
  it("prefers MP4/H.264 and falls back to webm", () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: (m: string) => m === "video/mp4" });
    expect(pickMime()).toBe("video/mp4");
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => false });
    expect(pickMime()).toBe("video/webm");
  });
});

describe("drawCaption", () => {
  const ctx = () =>
    ({
      fillRect: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      measureText: vi.fn(() => ({ width: 100 })),
    }) as unknown as CanvasRenderingContext2D;

  it.each(["stamp", "tape", "minimal"] as const)("draws the %s style", (style) => {
    const c = ctx();
    drawCaption(c, "Tre flip", style, 1920, 1080, 0);
    expect(c.fillText).toHaveBeenCalledWith(style === "minimal" ? "Tre flip" : "TRE FLIP", 960, expect.any(Number));
  });
});

describe("drawTapeStamp", () => {
  it("burns in PLAY and the date", () => {
    const fillText = vi.fn();
    drawTapeStamp({ fillText } as unknown as CanvasRenderingContext2D, 1920, 1080, new Date(2026, 9, 6));
    expect(fillText).toHaveBeenCalledWith("PLAY \u25B6", expect.any(Number), expect.any(Number));
    expect(fillText).toHaveBeenCalledWith("OCT. 06 2026", expect.any(Number), expect.any(Number));
  });
});

describe("EditorEngine", () => {
  it("refuses to start without WebGL", () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    const p = createProject({ id: "m", label: "A", durationSec: 1, offsetSec: 0, width: 1, height: 1, fps: 30 });
    expect(() => new EditorEngine(canvas, p)).toThrow("WebGL unavailable");
  });
});
