import { beforeEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({
  isAvailable: vi.fn(),
  render: vi.fn(),
  cancel: vi.fn(),
  writeSourceChunk: vi.fn(),
  addListener: vi.fn(),
}));
const cap = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
  isPluginAvailable: vi.fn(() => true),
  convertFileSrc: vi.fn((u: string) => `capacitor://localhost/_capacitor_file_${u}`),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: cap,
  registerPlugin: () => plugin,
}));

import {
  getNativeEditorSupport,
  renderNative,
  cancelNativeRender,
  stageSource,
  STAGE_CHUNK_BYTES,
} from "../clipEditorNative";

beforeEach(() => {
  vi.clearAllMocks();
  cap.isNativePlatform.mockReturnValue(true);
  cap.isPluginAvailable.mockReturnValue(true);
});

describe("getNativeEditorSupport", () => {
  it("is unavailable on the web or without the plugin", async () => {
    cap.isNativePlatform.mockReturnValue(false);
    expect((await getNativeEditorSupport()).available).toBe(false);
    cap.isNativePlatform.mockReturnValue(true);
    cap.isPluginAvailable.mockReturnValue(false);
    expect((await getNativeEditorSupport()).available).toBe(false);
  });

  it("reports 4K/60 when the device can", async () => {
    plugin.isAvailable.mockResolvedValue({ available: true, maxWidth: 3840, maxFps: 60, hevc: true });
    expect(await getNativeEditorSupport()).toEqual({ available: true, supports4k: true, supports60: true });
    plugin.isAvailable.mockResolvedValue({ available: true, maxWidth: 1920, maxFps: 30, hevc: false });
    expect(await getNativeEditorSupport()).toEqual({ available: true, supports4k: false, supports60: false });
  });

  it("treats a plugin that says no, or throws, as unavailable", async () => {
    plugin.isAvailable.mockResolvedValue({ available: false, maxWidth: 0, maxFps: 0, hevc: false });
    expect((await getNativeEditorSupport()).available).toBe(false);
    plugin.isAvailable.mockRejectedValue(new Error("UNIMPLEMENTED"));
    expect((await getNativeEditorSupport()).available).toBe(false);
  });
});

describe("renderNative", () => {
  const req = {
    sources: {},
    project: {} as never,
    plan: { width: 1, height: 1, fps: 30 as const, bitrate: 1 },
    audio: {},
    colorMatrix: [],
    saveToPhotos: false,
  };

  it("forwards progress and removes the listener", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    plugin.addListener.mockImplementation(async (_e: string, cb: (e: { progress: number }) => void) => {
      cb({ progress: 0.5 });
      return { remove };
    });
    plugin.render.mockResolvedValue({ fileUrl: "file:///tmp/out.mp4", bytes: 10, savedToPhotos: true });
    const onProgress = vi.fn();
    const r = await renderNative(req, onProgress);
    expect(onProgress).toHaveBeenCalledWith(0.5);
    expect(r.webUrl).toContain("out.mp4");
    expect(remove).toHaveBeenCalled();
  });

  it("works without a progress callback and rethrows failures", async () => {
    plugin.render.mockRejectedValue(new Error("boom"));
    await expect(renderNative(req)).rejects.toThrow("boom");
    expect(plugin.addListener).not.toHaveBeenCalled();
  });

  it("cancels", async () => {
    await cancelNativeRender();
    expect(plugin.cancel).toHaveBeenCalled();
  });
});

describe("stageSource", () => {
  it("streams a blob in chunks, appending after the first", async () => {
    plugin.writeSourceChunk.mockResolvedValue({ fileUrl: "file:///tmp/main.mp4" });
    const blob = new Blob([new Uint8Array(STAGE_CHUNK_BYTES + 10).fill(65)]);
    const url = await stageSource("main", blob);
    expect(url).toBe("file:///tmp/main.mp4");
    expect(plugin.writeSourceChunk).toHaveBeenCalledTimes(2);
    expect(plugin.writeSourceChunk.mock.calls[0][0]).toMatchObject({ id: "main", append: false });
    expect(plugin.writeSourceChunk.mock.calls[1][0]).toMatchObject({ append: true, data: btoa("A".repeat(10)) });
  });

  it("still creates the file for an empty blob", async () => {
    plugin.writeSourceChunk.mockResolvedValue({ fileUrl: "file:///tmp/e.mp4" });
    expect(await stageSource("e", new Blob([]))).toBe("file:///tmp/e.mp4");
    expect(plugin.writeSourceChunk).toHaveBeenCalledTimes(1);
  });
});
