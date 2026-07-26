import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ── mock @capacitor/core ──────────────────────────────────── */

const { mockIsNativePlatform } = vi.hoisted(() => ({
  mockIsNativePlatform: vi.fn(() => false),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: mockIsNativePlatform },
}));

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

/* ── mock global fetch ─────────────────────────────────────── */

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

/* ── mock sentry breadcrumb ─────────────────────────────── */

const { mockAddBreadcrumb } = vi.hoisted(() => ({
  mockAddBreadcrumb: vi.fn(),
}));

vi.mock("../../lib/sentry", () => ({
  addBreadcrumb: mockAddBreadcrumb,
}));

import { isNativePlatform, recordNativeVideo } from "../nativeVideo";
import { MAX_VIDEO_DURATION_MS } from "../../constants/video";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsNativePlatform.mockReturnValue(false);
  mockInitialize.mockResolvedValue(undefined);
  mockDestroy.mockResolvedValue(undefined);
  mockStartRecording.mockResolvedValue(undefined);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
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
