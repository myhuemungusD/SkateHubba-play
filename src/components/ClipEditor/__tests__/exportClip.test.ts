import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  getNativeEditorSupport: vi.fn(),
  renderNative: vi.fn(),
  stageSource: vi.fn(),
}));
vi.mock("../../../services/clipEditorNative", () => native);

import { exportClip, audioUrls } from "../exportClip";
import { readAngle } from "../readAngle";
import { createProject, setTrim } from "../../../lib/clipEditor/project";
import { placeSfx } from "../../../lib/clipEditor/overlays";
import type { EditorEngine } from "../../../lib/clipEditor/engine";
import { planExport, WEB_CAPABILITIES } from "../../../lib/clipEditor/exportPlan";
import type { EditProject } from "../../../lib/clipEditor/types";

const project = () =>
  createProject({ id: "main", label: "A", durationSec: 20, offsetSec: 0, width: 1920, height: 1080, fps: 60 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ blob: async () => new Blob(["mp4"]) })),
  );
});

describe("audioUrls", () => {
  it("lists music and each sfx as absolute URLs", () => {
    let p: EditProject = { ...project(), music: { trackId: "lofi-75", trackOffsetSec: 0, gain: 1, originalGain: 1 } };
    p = placeSfx(placeSfx(p, "bail", 1), "nope", 2);
    expect(audioUrls(p, "https://x.test")).toEqual({
      "lofi-75": "https://x.test/editor/music/lofi-75.m4a",
      bail: "https://x.test/editor/sfx/bail.m4a",
    });
    expect(
      audioUrls({ ...project(), music: { trackId: "gone", trackOffsetSec: 0, gain: 1, originalGain: 1 } }),
    ).toEqual({});
  });

  it("skips a placed sound that is no longer in the library", () => {
    const p: EditProject = { ...project(), sfx: [{ id: "sfx-1", soundId: "retired", outAtSec: 1, gain: 1 }] };
    expect(audioUrls(p, "https://x.test")).toEqual({});
  });
});

describe("exportClip", () => {
  it("uses the web exporter when native is unavailable", async () => {
    native.getNativeEditorSupport.mockResolvedValue({ available: false });
    const exportWeb = vi.fn().mockResolvedValue(new Blob(["webm"]));
    const r = await exportClip(project(), {}, { exportWeb } as unknown as EditorEngine, vi.fn());
    expect(r.savedFullQuality).toBe(false);
    expect(exportWeb.mock.calls[0][0]).toMatchObject({ width: 1920, height: 1080 });
  });

  it("renders once natively when the file fits", async () => {
    native.getNativeEditorSupport.mockResolvedValue({ available: true, supports4k: false, supports60: false });
    native.stageSource.mockResolvedValue("file:///main.mp4");
    native.renderNative.mockImplementation(async (_r: unknown, cb: (p: number) => void) => {
      cb(1);
      return { fileUrl: "f", webUrl: "w", bytes: 1, savedToPhotos: false };
    });
    const onProgress = vi.fn();
    const r = await exportClip(setTrim(project(), 0, 3), { main: new Blob(["x"]) }, {} as EditorEngine, onProgress);
    expect(native.renderNative).toHaveBeenCalledTimes(1);
    expect(native.renderNative.mock.calls[0][0].plan).toMatchObject({ width: 1920, fps: 30 });
    expect(native.renderNative.mock.calls[0][0].colorMatrix).toHaveLength(20);
    expect(onProgress).toHaveBeenCalledWith(1);
    expect(r.blob.type).toBe("video/mp4");
  });

  it("saves full 4K to Photos and returns a feed-sized second render when too big", async () => {
    native.getNativeEditorSupport.mockResolvedValue({ available: true, supports4k: true, supports60: true });
    native.stageSource.mockResolvedValue("file:///main.mp4");
    native.renderNative.mockImplementation(async (req: { saveToPhotos: boolean }, cb: (p: number) => void) => {
      cb(1);
      return { fileUrl: "f", webUrl: "w", bytes: 1, savedToPhotos: req.saveToPhotos };
    });
    const onProgress = vi.fn();
    const p = { ...project(), export: { resolution: "4k" as const, fps: 60 as const } };
    const r = await exportClip(p, { main: new Blob(["x"]) }, {} as EditorEngine, onProgress);
    expect(native.renderNative).toHaveBeenCalledTimes(2);
    expect(native.renderNative.mock.calls[0][0]).toMatchObject({ saveToPhotos: true, plan: { width: 3840, fps: 60 } });
    expect(native.renderNative.mock.calls[1][0].plan.bitrate).toBeLessThan(
      native.renderNative.mock.calls[0][0].plan.bitrate,
    );
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([0.5, 1]);
    expect(r.savedFullQuality).toBe(true);
  });

  it("web export compresses to fit when over the cap", async () => {
    native.getNativeEditorSupport.mockResolvedValue({ available: false });
    const exportWeb = vi.fn().mockResolvedValue(new Blob(["webm"]));
    const p = createProject({
      id: "main",
      label: "A",
      durationSec: 60,
      offsetSec: 0,
      width: 1920,
      height: 1080,
      fps: 60,
    });
    await exportClip(p, {}, { exportWeb } as unknown as EditorEngine, vi.fn());
    expect(exportWeb.mock.calls[0][0].bitrate).toBeLessThan(18_000_000);
  });
});

describe("exportClip web bitrate", () => {
  it("keeps the planned bitrate when a short web edit fits under the cap", async () => {
    native.getNativeEditorSupport.mockResolvedValue({ available: false });
    const exportWeb = vi.fn().mockResolvedValue(new Blob(["webm"]));
    const short = setTrim(project(), 0, 2);
    const plan = planExport(short, WEB_CAPABILITIES);
    expect(plan.exceedsUploadCap).toBe(false);
    await exportClip(short, {}, { exportWeb } as unknown as EditorEngine, vi.fn());
    expect(exportWeb.mock.calls[0][0].bitrate).toBe(plan.bitrate);
  });
});

describe("readAngle", () => {
  const stubVideo = (props: Record<string, unknown>, fire: "onloadedmetadata" | "onerror") => {
    const real = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = real(tag);
      if (tag !== "video") return el;
      for (const [k, v] of Object.entries(props)) Object.defineProperty(el, k, { value: v });
      Object.defineProperty(el, "src", {
        set() {
          queueMicrotask(() => (el as unknown as Record<string, () => void>)[fire]());
        },
      });
      return el;
    });
  };
  beforeEach(() => {
    vi.restoreAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });

  it("reads duration and size", async () => {
    stubVideo({ duration: 7, videoWidth: 3840, videoHeight: 2160 }, "onloadedmetadata");
    const r = await readAngle(new Blob(["x"]), "a", "Angle");
    expect(r.angle).toMatchObject({ durationSec: 7, width: 3840, height: 2160 });
    expect(r.url).toBe("blob:x");
  });

  it("defaults size and rejects zero duration", async () => {
    stubVideo({ duration: Infinity, videoWidth: 0, videoHeight: 0 }, "onloadedmetadata");
    await expect(readAngle(new Blob(["x"]), "a", "A")).rejects.toThrow("no duration");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });

  it("falls back to 1080p when dimensions are missing", async () => {
    stubVideo({ duration: 3, videoWidth: 0, videoHeight: 0 }, "onloadedmetadata");
    expect((await readAngle(new Blob(["x"]), "a", "A")).angle).toMatchObject({ width: 1920, height: 1080 });
  });

  it("rejects unreadable files and revokes the URL", async () => {
    stubVideo({}, "onerror");
    await expect(readAngle(new Blob(["x"]), "a", "A")).rejects.toThrow("unreadable");
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});
