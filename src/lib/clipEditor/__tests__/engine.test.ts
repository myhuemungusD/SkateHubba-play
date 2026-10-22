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

describe("EditorEngine.seek", () => {
  // Every WebGL call is a no-op that returns a truthy handle.
  const fakeGl = (): WebGLRenderingContext =>
    new Proxy({} as Record<string | symbol, unknown>, {
      get: (_t, k) => (typeof k === "string" && /^[A-Z_0-9]+$/.test(k) ? 1 : () => ({})),
    }) as unknown as WebGLRenderingContext;
  const makeEngine = () => {
    const canvas = { getContext: () => fakeGl(), width: 1, height: 1 } as unknown as HTMLCanvasElement;
    const p = createProject({ id: "m", label: "A", durationSec: 5, offsetSec: 0, width: 1, height: 1, fps: 30 });
    const e = new EditorEngine(canvas, p);
    e.setSources({ m: "blob:m" });
    vi.spyOn(e, "draw").mockImplementation(() => {});
    return e;
  };

  it("settles when the video reports an error instead of seeked", async () => {
    const e = makeEngine();
    const video = (e as unknown as { videos: Map<string, HTMLVideoElement> }).videos.get("m")!;
    const done = e.seek(2);
    video.dispatchEvent(new Event("error"));
    await expect(done).resolves.toBeUndefined();
  });

  it("settles on seeked and detaches both listeners", async () => {
    const e = makeEngine();
    const video = (e as unknown as { videos: Map<string, HTMLVideoElement> }).videos.get("m")!;
    const remove = vi.spyOn(video, "removeEventListener");
    const done = e.seek(3);
    video.dispatchEvent(new Event("seeked"));
    await expect(done).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith("seeked", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("error", expect.any(Function));
  });
});
