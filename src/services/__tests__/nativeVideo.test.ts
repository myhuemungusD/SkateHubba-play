import { describe, it, expect, vi, beforeEach, afterEach, afterAll, type MockInstance } from "vitest";

/* ── mock @capacitor/core ──────────────────────────────────── */

const { mockIsNativePlatform } = vi.hoisted(() => ({
  mockIsNativePlatform: vi.fn(() => false),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: mockIsNativePlatform },
}));

const { mockPro } = vi.hoisted(() => ({ mockPro: vi.fn() }));

/* ── mock @capacitor-community/video-recorder ──────────────── */

const { mockInitialize, mockDestroy, mockStartRecording, mockStopRecording } = vi.hoisted(() => ({
  mockInitialize: vi.fn<() => Promise<void>>(),
  mockDestroy: vi.fn<() => Promise<void>>(),
  mockStartRecording: vi.fn<() => Promise<void>>(),
  mockStopRecording: vi.fn<() => Promise<{ videoUrl: string }>>(),
}));

vi.mock("@capacitor-community/video-recorder", () => ({
  VideoRecorder: {
    initialize: mockInitialize,
    destroy: mockDestroy,
    startRecording: mockStartRecording,
    stopRecording: mockStopRecording,
    setZoom: (o: { lens: number }) => mockPro("setZoom", o),
    getLensInfo: () => mockPro("getLensInfo"),
    focusAt: (o: unknown) => mockPro("focusAt", o),
    setQuality: (o: unknown) => mockPro("setQuality", o),
    getQualityModes: () => mockPro("getQualityModes"),
    getPerformanceMetrics: () => mockPro("getPerformanceMetrics"),
    setPreRoll: (o: unknown) => mockPro("setPreRoll", o),
    getPreRollStatus: () => mockPro("getPreRollStatus"),
    setNativeFisheye: (o: unknown) => mockPro("setNativeFisheye", o),
  },
  VideoRecorderCamera: { FRONT: 0, BACK: 1 },
  VideoRecorderQuality: {
    MAX_480P: 0,
    MAX_720P: 1,
    MAX_1080P: 2,
    MAX_2160P: 3,
    HIGHEST: 4,
    LOWEST: 5,
    QVGA: 6,
  },
}));

/* ── mock global fetch / performance.now ───────────────────── */

// Both are installed per test and restored afterwards. The old module-level
// vi.stubGlobal("performance", …) swapped out the whole global for the life of
// the worker, which vitest's own timing and V8 coverage collection share; it
// was the likely trigger of the corrupted (negative) nativeVideo.ts branch
// counts in 878-hesher.md. Spying on now() alone leaves the real object intact.
const mockFetch = vi.fn();
let mockPerformanceNow: MockInstance<() => number>;

/* ── mock sentry breadcrumb ─────────────────────────────── */

const { mockAddBreadcrumb } = vi.hoisted(() => ({
  mockAddBreadcrumb: vi.fn(),
}));

vi.mock("../../lib/sentry", () => ({
  addBreadcrumb: mockAddBreadcrumb,
}));

import {
  closeNativePreview,
  isNativePlatform,
  isNativePreviewLive,
  openNativePreview,
  recordNativeVideo,
} from "../nativeVideo";
import { MAX_VIDEO_DURATION_MS } from "../../constants/video";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  mockPerformanceNow = vi.spyOn(performance, "now").mockReturnValue(0);
  mockIsNativePlatform.mockReturnValue(false);
  mockInitialize.mockResolvedValue(undefined);
  mockDestroy.mockResolvedValue(undefined);
  mockStartRecording.mockResolvedValue(undefined);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  mockPerformanceNow.mockRestore();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/**
 * Helper: advance fake timers past the MAX_VIDEO_DURATION_MS auto-stop
 * inside the service, letting the recording promise chain resolve.
 */
async function flushAutoStop(): Promise<void> {
  // Advance past the duration cap and let queued microtasks drain.
  await vi.advanceTimersByTimeAsync(MAX_VIDEO_DURATION_MS + 1);
}

/* ── Tests ─────────────────────────────────────────────────── */

describe("nativeVideo service", () => {
  describe("isNativePlatform", () => {
    it("returns true when running in a Capacitor native shell", () => {
      mockIsNativePlatform.mockReturnValue(true);
      expect(isNativePlatform()).toBe(true);
    });

    it("returns false on the web", () => {
      mockIsNativePlatform.mockReturnValue(false);
      expect(isNativePlatform()).toBe(false);
    });
  });

  describe("recordNativeVideo — happy path", () => {
    it("initializes, records, fetches the URI and returns a video blob", async () => {
      const fakeBlob = new Blob(["video-data"], { type: "video/mp4" });
      mockStopRecording.mockResolvedValue({ videoUrl: "file:///tmp/video.mp4" });
      mockFetch.mockResolvedValue({ blob: (): Promise<Blob> => Promise.resolve(fakeBlob) });

      const pending = recordNativeVideo();
      await flushAutoStop();
      const result = await pending;

      expect(mockInitialize).toHaveBeenCalledTimes(1);
      expect(mockInitialize).toHaveBeenCalledWith(
        expect.objectContaining({
          camera: 1, // BACK
          quality: 2, // MAX_1080P
          autoShow: true,
        }),
      );
      expect(mockStartRecording).toHaveBeenCalledTimes(1);
      expect(mockStopRecording).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith("file:///tmp/video.mp4");
      expect(result.blob).toBe(fakeBlob);
      expect(result.mimeType).toBe("video/mp4");
      expect(result.mimeType.startsWith("video/")).toBe(true);
      // Temp-file handle disposal: destroy() must always run on success.
      expect(mockDestroy).toHaveBeenCalledTimes(1);
    });

    it("falls back to video/mp4 when the fetched blob has no type", async () => {
      const fakeBlob = new Blob(["video-data"], { type: "" });
      mockStopRecording.mockResolvedValue({ videoUrl: "file:///tmp/clip.mov" });
      mockFetch.mockResolvedValue({ blob: (): Promise<Blob> => Promise.resolve(fakeBlob) });

      const pending = recordNativeVideo();
      await flushAutoStop();
      const result = await pending;

      expect(result.mimeType).toBe("video/mp4");
      expect(result.mimeType.startsWith("video/")).toBe(true);
      // Blob is re-wrapped so its .type matches the declared mimeType.
      expect(result.blob.type).toBe("video/mp4");
      expect(mockDestroy).toHaveBeenCalledTimes(1);
    });

    it("coerces unsupported video mime types (e.g. quicktime) to video/mp4", async () => {
      // iOS can report `video/quicktime` for .mp4-containerised clips.
      // Firebase Storage rules only accept video/mp4 or video/webm on the
      // native path, so the service must coerce to video/mp4.
      const fakeBlob = new Blob(["video-data"], { type: "video/quicktime" });
      mockStopRecording.mockResolvedValue({ videoUrl: "file:///tmp/clip.mov" });
      mockFetch.mockResolvedValue({ blob: (): Promise<Blob> => Promise.resolve(fakeBlob) });

      const pending = recordNativeVideo();
      await flushAutoStop();
      const result = await pending;

      expect(result.mimeType).toBe("video/mp4");
      expect(result.mimeType.startsWith("video/")).toBe(true);
      expect(result.blob.type).toBe("video/mp4");
    });

    it("preserves video/webm when reported (cross-platform path through storage.ts)", async () => {
      const fakeBlob = new Blob(["video-data"], { type: "video/webm" });
      mockStopRecording.mockResolvedValue({ videoUrl: "file:///tmp/clip.webm" });
      mockFetch.mockResolvedValue({ blob: (): Promise<Blob> => Promise.resolve(fakeBlob) });

      const pending = recordNativeVideo();
      await flushAutoStop();
      const result = await pending;

      expect(result.mimeType).toBe("video/webm");
      expect(result.blob).toBe(fakeBlob);
    });
  });

  describe("recordNativeVideo — error paths", () => {
    it("throws and still releases the camera when the plugin returns no URI", async () => {
      mockStopRecording.mockResolvedValue({ videoUrl: "" });

      // Attach a catch handler BEFORE advancing timers so Node/Vitest does
      // not report an unhandled rejection during microtask flushing.
      const pending = recordNativeVideo();
      const caught = pending.catch((e: unknown) => e);
      await flushAutoStop();
      const err = await caught;

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("Native camera returned no file path");
      // destroy() runs in the finally block — guaranteed on error.
      expect(mockDestroy).toHaveBeenCalledTimes(1);
      // fetch is never called if there's no URI to fetch.
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("propagates permission denial from initialize() without calling recording APIs", async () => {
      mockInitialize.mockRejectedValue(new Error("CAMERA_DENIED"));

      await expect(recordNativeVideo()).rejects.toThrow("CAMERA_DENIED");

      expect(mockStartRecording).not.toHaveBeenCalled();
      expect(mockStopRecording).not.toHaveBeenCalled();
      // initialize() threw before we marked the plugin as initialized, so
      // destroy() must NOT run — there is nothing to tear down.
      expect(mockDestroy).not.toHaveBeenCalled();
    });

    it("propagates user-cancel thrown from stopRecording() and still tears down", async () => {
      mockStopRecording.mockRejectedValue(new Error("User cancelled recording"));

      const pending = recordNativeVideo();
      const caught = pending.catch((e: unknown) => e);
      await flushAutoStop();
      const err = await caught;

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("User cancelled recording");
      expect(mockDestroy).toHaveBeenCalledTimes(1);
    });

    it("propagates fetch errors when the temp file cannot be read", async () => {
      mockStopRecording.mockResolvedValue({ videoUrl: "file:///tmp/video.mp4" });
      mockFetch.mockRejectedValue(new Error("Network request failed"));

      const pending = recordNativeVideo();
      const caught = pending.catch((e: unknown) => e);
      await flushAutoStop();
      const err = await caught;

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("Network request failed");
      expect(mockDestroy).toHaveBeenCalledTimes(1);
    });

    it("swallows destroy() errors so they don't mask the real failure", async () => {
      mockStopRecording.mockRejectedValue(new Error("record failed"));
      mockDestroy.mockRejectedValue(new Error("teardown also failed"));

      const pending = recordNativeVideo();
      const caught = pending.catch((e: unknown) => e);
      await flushAutoStop();
      const err = await caught;

      // The original record-failure surfaces, not the teardown error.
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("record failed");
      expect(mockDestroy).toHaveBeenCalledTimes(1);
    });
  });

  describe("recordNativeVideo — duration cap", () => {
    it("stops recording after MAX_VIDEO_DURATION_MS", async () => {
      const fakeBlob = new Blob(["data"], { type: "video/mp4" });
      mockStopRecording.mockResolvedValue({ videoUrl: "file:///tmp/v.mp4" });
      mockFetch.mockResolvedValue({ blob: (): Promise<Blob> => Promise.resolve(fakeBlob) });

      const pending = recordNativeVideo();

      // One tick shy of the cap — stopRecording must NOT have fired yet.
      await vi.advanceTimersByTimeAsync(MAX_VIDEO_DURATION_MS - 1);
      expect(mockStopRecording).not.toHaveBeenCalled();

      // Cross the threshold — the auto-stop resolves and stopRecording runs.
      await vi.advanceTimersByTimeAsync(2);
      await pending;
      expect(mockStopRecording).toHaveBeenCalledTimes(1);
    });
  });

  describe("recordNativeVideo — AbortSignal early-stop", () => {
    it("rejects immediately with AbortError when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(recordNativeVideo(controller.signal)).rejects.toMatchObject({
        name: "AbortError",
      });
      // Never entered the plugin lifecycle — no initialize, no destroy.
      expect(mockInitialize).not.toHaveBeenCalled();
      expect(mockDestroy).not.toHaveBeenCalled();
    });

    it("stops recording early when signal fires during the duration wait", async () => {
      const fakeBlob = new Blob(["data"], { type: "video/mp4" });
      mockStopRecording.mockResolvedValue({ videoUrl: "file:///tmp/v.mp4" });
      mockFetch.mockResolvedValue({ blob: (): Promise<Blob> => Promise.resolve(fakeBlob) });

      const controller = new AbortController();
      const pending = recordNativeVideo(controller.signal);

      // Flush the initial microtasks so `initialize` + `startRecording` resolve
      // and the service arrives at the duration-wait Promise.
      await vi.advanceTimersByTimeAsync(0);
      expect(mockStopRecording).not.toHaveBeenCalled();

      // Fire the abort well before the duration cap — recording should
      // stop early as soon as the abort event handler runs.
      controller.abort();
      await pending;

      expect(mockStopRecording).toHaveBeenCalledTimes(1);
      expect(mockDestroy).toHaveBeenCalledTimes(1);
    });
  });

  describe("recordNativeVideo — abort during camera warm-up", () => {
    /**
     * The caller flips its UI to "recording" and renders a working Stop button
     * synchronously, long before the camera is ready — an OS permission dialog
     * on first launch sits for tens of seconds. The abort listener used to be
     * registered only AFTER initialize() and startRecording() both resolved,
     * and addEventListener("abort", …) on an already-fired signal never runs,
     * so those taps were dropped. Worse, they were dropped permanently:
     * AbortController.abort() is a no-op once aborted, so every later tap died
     * too, the clip ran the full cap and was submitted anyway, and the unmount
     * path could not release the camera at all.
     */
    it("cancels the take when abort fires while initialize() is still pending", async () => {
      let releaseInitialize: () => void = () => undefined;
      mockInitialize.mockImplementation(() => new Promise<void>((r) => (releaseInitialize = r)));

      const controller = new AbortController();
      const pending = recordNativeVideo(controller.signal);
      await vi.advanceTimersByTimeAsync(0);

      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });

      // Never started capturing, so there is no take to keep.
      expect(mockStartRecording).not.toHaveBeenCalled();
      expect(mockStopRecording).not.toHaveBeenCalled();
      // We walked away from a still-running initialize and cannot know whether
      // it went on to open the device — tear down rather than strand it.
      expect(mockDestroy).toHaveBeenCalledTimes(1);

      releaseInitialize();
    });

    it("cancels the take when abort fires between initialize() and startRecording()", async () => {
      let releaseStart: () => void = () => undefined;
      mockStartRecording.mockImplementation(() => new Promise<void>((r) => (releaseStart = r)));

      const controller = new AbortController();
      const pending = recordNativeVideo(controller.signal);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockInitialize).toHaveBeenCalledTimes(1);

      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });

      expect(mockStopRecording).not.toHaveBeenCalled();
      expect(mockDestroy).toHaveBeenCalledTimes(1);

      releaseStart();
    });

    it("invokes onRecordingStarted once, only after frames begin", async () => {
      const fakeBlob = new Blob(["data"], { type: "video/mp4" });
      mockStopRecording.mockResolvedValue({ videoUrl: "file:///tmp/v.mp4" });
      mockFetch.mockResolvedValue({ blob: (): Promise<Blob> => Promise.resolve(fakeBlob) });

      let releaseStart: () => void = () => undefined;
      mockStartRecording.mockImplementation(() => new Promise<void>((r) => (releaseStart = r)));
      const onRecordingStarted = vi.fn();

      const pending = recordNativeVideo(undefined, onRecordingStarted);
      await vi.advanceTimersByTimeAsync(0);
      // Still warming up — the caller's clock must not have started.
      expect(onRecordingStarted).not.toHaveBeenCalled();

      releaseStart();
      await vi.advanceTimersByTimeAsync(0);
      expect(onRecordingStarted).toHaveBeenCalledTimes(1);

      await flushAutoStop();
      await pending;
      expect(onRecordingStarted).toHaveBeenCalledTimes(1);
    });

    /**
     * A caller may abort from inside `onRecordingStarted` itself — that is the
     * one moment an abort can land between retiring the warm-up handler and
     * arming the duration-race handler. Without the already-aborted check in
     * the race promise, no listener would ever fire and the take would sit out
     * the full cap before stopping.
     */
    it("stops immediately when the start callback aborts the take", async () => {
      const fakeBlob = new Blob(["data"], { type: "video/mp4" });
      mockStopRecording.mockResolvedValue({ videoUrl: "file:///tmp/v.mp4" });
      mockFetch.mockResolvedValue({ blob: (): Promise<Blob> => Promise.resolve(fakeBlob) });

      const controller = new AbortController();
      const pending = recordNativeVideo(controller.signal, () => controller.abort());

      // No timer advance at all: if the abort were missed, this would hang
      // until the duration cap instead of resolving here.
      await expect(pending).resolves.toMatchObject({ mimeType: "video/mp4" });
      expect(mockStopRecording).toHaveBeenCalledTimes(1);
      expect(mockDestroy).toHaveBeenCalledTimes(1);
    });

    it("does not invoke onRecordingStarted when the take is aborted during warm-up", async () => {
      let releaseInitialize: () => void = () => undefined;
      mockInitialize.mockImplementation(() => new Promise<void>((r) => (releaseInitialize = r)));
      const onRecordingStarted = vi.fn();

      const controller = new AbortController();
      const pending = recordNativeVideo(controller.signal, onRecordingStarted);
      await vi.advanceTimersByTimeAsync(0);

      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(onRecordingStarted).not.toHaveBeenCalled();

      releaseInitialize();
    });
  });

  describe("recordNativeVideo — performance API coverage", () => {
    async function setupPerformanceTest() {
      mockIsNativePlatform.mockReturnValue(true);
      mockStopRecording.mockResolvedValueOnce({ videoUrl: "file:///tmp/v.mp4" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(["x"], { type: "video/mp4" }),
      });
    }

    it("measures record-start latency when performance API is available", async () => {
      let callTime = 0;
      mockPerformanceNow.mockImplementation(() => {
        callTime += 50;
        return callTime;
      });
      await setupPerformanceTest();
      const pending = recordNativeVideo();
      await flushAutoStop();
      await pending;
      expect(mockAddBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "camera",
          message: "native_record_start_ms",
          data: expect.objectContaining({ ms: expect.any(Number) }),
        }),
      );
    });

    it("handles missing performance API gracefully (both branches)", async () => {
      const originalPerf = global.performance;
      // Temporarily remove performance to test the fallback branch
      // @ts-expect-error - testing undefined performance
      delete global.performance;
      await setupPerformanceTest();
      const pending = recordNativeVideo();
      await flushAutoStop();
      const result = await pending;
      expect(result.mimeType).toBe("video/mp4");
      // Restore performance
      global.performance = originalPerf;
    });
  });

  describe("recordNativeVideo — destroy() breadcrumb", () => {
    it("breadcrumbs when destroy() throws on the happy-path teardown", async () => {
      const fakeBlob = new Blob(["data"], { type: "video/mp4" });
      mockStopRecording.mockResolvedValue({ videoUrl: "file:///tmp/v.mp4" });
      mockFetch.mockResolvedValue({ blob: (): Promise<Blob> => Promise.resolve(fakeBlob) });
      mockDestroy.mockRejectedValue(new Error("teardown failed"));

      const pending = recordNativeVideo();
      await flushAutoStop();
      await pending;

      expect(mockAddBreadcrumb).toHaveBeenCalledWith({
        category: "lifecycle",
        message: "video_recorder_destroy_failed",
        data: { error: "teardown failed" },
      });
    });
  });
});

describe("native pro-capture extras", () => {
  beforeEach(() => {
    mockPro.mockReset();
    // Enable pro camera flag for all pro-capture tests
    vi.stubEnv("VITE_FEATURE_PRO_CAMERA", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns safe defaults when pro camera flag is off", async () => {
    vi.stubEnv("VITE_FEATURE_PRO_CAMERA", "false");
    const {
      getNativeLenses,
      setNativeLens,
      focusNativeAt,
      setNativeQuality,
      getNativeQualityModes,
      getNativeMetrics,
      setNativePreRoll,
      getNativePreRollStatus,
      setNativeFisheye,
    } = await import("../nativeVideo");
    expect(await getNativeLenses()).toEqual([]);
    expect(await setNativeLens(0.5)).toBe(false);
    expect(await focusNativeAt(0.5, 0.5, true)).toBe(false);
    expect(await setNativeQuality("pro4k60")).toBe(false);
    expect(await getNativeQualityModes()).toEqual({ modes: ["standard1080p60"], current: "standard1080p60" });
    expect(await getNativeMetrics()).toBeNull();
    expect(await setNativePreRoll(true)).toBe(false);
    expect(await getNativePreRollStatus()).toBeNull();
    expect(await setNativeFisheye(true)).toBe(false);
  });

  it("lists 0.5x/1x/2x on an ultra-wide phone and 1x only otherwise", async () => {
    const { getNativeLenses } = await import("../nativeVideo");
    mockPro.mockResolvedValueOnce({ ultraWide: true, maxLens: 15 });
    expect(await getNativeLenses()).toEqual([0.5, 1, 2]);
    mockPro.mockResolvedValueOnce({ ultraWide: false, maxLens: 1 });
    expect(await getNativeLenses()).toEqual([1]);
    // Test when getLensInfo returns null/undefined
    mockPro.mockResolvedValueOnce(null);
    expect(await getNativeLenses()).toEqual([]);
    // Test error case
    const unimpl = Promise.reject(new Error("UNIMPLEMENTED"));
    unimpl.catch(() => {});
    mockPro.mockReturnValueOnce(unimpl);
    expect(await getNativeLenses()).toEqual([]);
  });

  it("ramps the lens and clamps focus points, returning false when unsupported", async () => {
    const { setNativeLens, focusNativeAt } = await import("../nativeVideo");
    mockPro.mockResolvedValue({});
    expect(await setNativeLens(0.5)).toBe(true);
    expect(mockPro).toHaveBeenCalledWith("setZoom", { lens: 0.5 });
    expect(await focusNativeAt(1.4, -0.2, true)).toBe(true);
    expect(mockPro).toHaveBeenCalledWith("focusAt", { x: 1, y: 0, lock: true });
    mockPro.mockReset();
    mockPro.mockImplementationOnce(() => Promise.reject(new Error("no")));
    mockPro.mockImplementationOnce(() => Promise.reject(new Error("no")));
    expect(await setNativeLens(2)).toBe(false);
    expect(await focusNativeAt(0.5, 0.5, false)).toBe(false);
  });

  it("sets and queries quality modes", async () => {
    const { setNativeQuality, getNativeQualityModes } = await import("../nativeVideo");
    mockPro.mockResolvedValueOnce({ quality: "pro4k60" });
    expect(await setNativeQuality("pro4k60")).toBe(true);
    expect(mockPro).toHaveBeenCalledWith("setQuality", { quality: "pro4k60" });
    mockPro.mockResolvedValueOnce({ modes: ["standard1080p60", "pro4k60", "slomo120"], current: "pro4k60" });
    const modes = await getNativeQualityModes();
    expect(modes.modes).toEqual(["standard1080p60", "pro4k60", "slomo120"]);
    expect(modes.current).toBe("pro4k60");
    mockPro.mockReset();
    mockPro.mockImplementationOnce(() => Promise.reject(new Error("no")));
    expect(await setNativeQuality("slomo240")).toBe(false);
    mockPro.mockImplementationOnce(() => Promise.reject(new Error("no")));
    const fallback = await getNativeQualityModes();
    expect(fallback.modes).toEqual(["standard1080p60"]);
    expect(fallback.current).toBe("standard1080p60");
  });

  it("fetches performance metrics", async () => {
    const { getNativeMetrics } = await import("../nativeVideo");
    mockPro.mockResolvedValueOnce({
      previewFps: 59.8,
      droppedFrames: 2,
      thermalState: "nominal",
      quality: "standard1080p60",
    });
    const metrics = await getNativeMetrics();
    expect(metrics).toEqual({
      previewFps: 59.8,
      droppedFrames: 2,
      thermalState: "nominal",
      quality: "standard1080p60",
    });
    // Test the || null branch (when getPerformanceMetrics returns undefined)
    mockPro.mockResolvedValueOnce(undefined);
    expect(await getNativeMetrics()).toBeNull();
    // Test error case
    mockPro.mockReset();
    mockPro.mockImplementationOnce(() => Promise.reject(new Error("no")));
    expect(await getNativeMetrics()).toBeNull();
  });

  it("enables and checks pre-roll buffer status", async () => {
    const { setNativePreRoll, getNativePreRollStatus } = await import("../nativeVideo");
    // Test enabling
    mockPro.mockResolvedValueOnce({ enabled: true });
    expect(await setNativePreRoll(true)).toBe(true);
    expect(mockPro).toHaveBeenCalledWith("setPreRoll", { enabled: true });
    // Test disabling
    mockPro.mockResolvedValueOnce({ enabled: false });
    expect(await setNativePreRoll(false)).toBe(true);
    expect(mockPro).toHaveBeenCalledWith("setPreRoll", { enabled: false });
    // Test status check
    mockPro.mockResolvedValueOnce({ enabled: true, bufferedSeconds: 2.3, bufferCount: 138 });
    const status = await getNativePreRollStatus();
    expect(status).toEqual({ enabled: true, bufferedSeconds: 2.3, bufferCount: 138 });
    // Test the || null branch (when getPreRollStatus returns undefined)
    mockPro.mockResolvedValueOnce(undefined);
    expect(await getNativePreRollStatus()).toBeNull();
    mockPro.mockReset();
    // Test error cases
    mockPro.mockImplementationOnce(() => Promise.reject(new Error("no")));
    expect(await setNativePreRoll(false)).toBe(false);
    mockPro.mockImplementationOnce(() => Promise.reject(new Error("no")));
    expect(await getNativePreRollStatus()).toBeNull();
  });

  it("enables native AVFoundation fisheye effect", async () => {
    const { setNativeFisheye } = await import("../nativeVideo");
    // Test enabling with strength
    mockPro.mockResolvedValueOnce({ enabled: true, strength: 2.0 });
    expect(await setNativeFisheye(true, 2.0)).toBe(true);
    expect(mockPro).toHaveBeenCalledWith("setNativeFisheye", { enabled: true, strength: 2.0 });
    // Test disabling (hits the "off" branch in breadcrumb)
    mockPro.mockResolvedValueOnce({ enabled: false, strength: 0 });
    expect(await setNativeFisheye(false, 0)).toBe(true);
    expect(mockPro).toHaveBeenCalledWith("setNativeFisheye", { enabled: false, strength: 0 });
    // Test error case
    mockPro.mockReset();
    mockPro.mockImplementationOnce(() => Promise.reject(new Error("no")));
    expect(await setNativeFisheye(true, 3.0)).toBe(false);
  });

  it("returns false when native functions are not available", async () => {
    // Test the defensive !pro.xxx checks by temporarily removing those methods
    const VideoRecorder = await import("@capacitor-community/video-recorder").then((m) => m.VideoRecorder);
    const vr = VideoRecorder as unknown as Record<string, unknown>;
    const originalSetZoom = vr.setZoom;
    const originalFocusAt = vr.focusAt;
    const originalSetQuality = vr.setQuality;
    const originalGetQualityModes = vr.getQualityModes;
    const originalSetPreRoll = vr.setPreRoll;
    const originalSetNativeFisheye = vr.setNativeFisheye;

    try {
      // Temporarily remove the methods
      delete vr.setZoom;
      delete vr.focusAt;
      delete vr.setQuality;
      delete vr.getQualityModes;
      delete vr.setPreRoll;
      delete vr.setNativeFisheye;

      const {
        setNativeLens,
        focusNativeAt,
        setNativeQuality,
        getNativeQualityModes,
        setNativePreRoll,
        setNativeFisheye,
      } = await import("../nativeVideo");
      expect(await setNativeLens(1)).toBe(false);
      expect(await focusNativeAt(0.5, 0.5, false)).toBe(false);
      expect(await setNativeQuality("pro4k60")).toBe(false);
      expect(await getNativeQualityModes()).toEqual({ modes: ["standard1080p60"], current: "standard1080p60" });
      expect(await setNativePreRoll(true)).toBe(false);
      expect(await setNativeFisheye(true)).toBe(false);
    } finally {
      // Restore the methods
      vr.setZoom = originalSetZoom;
      vr.focusAt = originalFocusAt;
      vr.setQuality = originalSetQuality;
      vr.getQualityModes = originalGetQualityModes;
      vr.setPreRoll = originalSetPreRoll;
      vr.setNativeFisheye = originalSetNativeFisheye;
    }
  });
});

/* ── Live preview before recording (build 3 "no preview" fix) ── */

describe("native live preview", () => {
  afterEach(async () => {
    await closeNativePreview();
  });

  it("opens the preview once, reports it live, and releases it on close", async () => {
    await expect(openNativePreview()).resolves.toBe(true);
    expect(isNativePreviewLive()).toBe(true);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockInitialize).toHaveBeenCalledWith(expect.objectContaining({ camera: 1, quality: 2, autoShow: true }));
    expect(mockAddBreadcrumb).toHaveBeenCalledWith({ category: "camera", message: "native_preview_open" });

    // Already live: no second initialize (the plugin would never settle it).
    await expect(openNativePreview()).resolves.toBe(true);
    expect(mockInitialize).toHaveBeenCalledTimes(1);

    await closeNativePreview();
    expect(isNativePreviewLive()).toBe(false);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("records on the live preview without re-initializing, then releases the camera", async () => {
    const fakeBlob = new Blob(["video-data"], { type: "video/mp4" });
    mockStopRecording.mockResolvedValue({ videoUrl: "file:///tmp/video.mp4" });
    mockFetch.mockResolvedValue({ blob: (): Promise<Blob> => Promise.resolve(fakeBlob) });
    await openNativePreview();

    const pending = recordNativeVideo();
    await flushAutoStop();
    const result = await pending;

    expect(result.blob).toBe(fakeBlob);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockStartRecording).toHaveBeenCalledTimes(1);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
    expect(isNativePreviewLive()).toBe(false);
  });

  it("releases a half-built session and rethrows when initialize rejects", async () => {
    mockInitialize.mockRejectedValueOnce(new Error("denied"));
    await expect(openNativePreview()).rejects.toThrow("denied");
    expect(mockDestroy).toHaveBeenCalledTimes(1);
    expect(isNativePreviewLive()).toBe(false);
  });

  it("tears down an open that resolves after a close landed", async () => {
    let resolveInit: () => void = () => undefined;
    mockInitialize.mockReturnValueOnce(new Promise<void>((r) => (resolveInit = r)));
    const opening = openNativePreview();
    await closeNativePreview();
    resolveInit();
    await expect(opening).resolves.toBe(false);
    expect(isNativePreviewLive()).toBe(false);
    // Once for the close, once for the stale session.
    expect(mockDestroy).toHaveBeenCalledTimes(2);
  });

  it("queues a second open behind the one in flight (StrictMode remount)", async () => {
    let resolveInit: () => void = () => undefined;
    mockInitialize.mockReturnValueOnce(new Promise<void>((r) => (resolveInit = r)));
    const first = openNativePreview();
    const second = openNativePreview();
    resolveInit();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it("retries from scratch when the queued-behind open failed", async () => {
    let rejectInit: (e: Error) => void = () => undefined;
    mockInitialize.mockReturnValueOnce(new Promise<void>((_, rej) => (rejectInit = rej)));
    const first = openNativePreview();
    const second = openNativePreview();
    rejectInit(new Error("busy"));
    await expect(first).rejects.toThrow("busy");
    await expect(second).resolves.toBe(true);
    expect(mockInitialize).toHaveBeenCalledTimes(2);
    expect(isNativePreviewLive()).toBe(true);
  });

  it("breadcrumbs a failed teardown on close instead of throwing", async () => {
    mockDestroy.mockRejectedValueOnce(new Error("teardown"));
    await expect(closeNativePreview()).resolves.toBeUndefined();
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "video_recorder_destroy_failed", data: { error: "teardown" } }),
    );
  });

  it("stringifies a non-Error teardown rejection in the breadcrumb", async () => {
    mockDestroy.mockRejectedValueOnce("plugin gone");
    await expect(closeNativePreview()).resolves.toBeUndefined();
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "video_recorder_destroy_failed", data: { error: "plugin gone" } }),
    );
  });
});
