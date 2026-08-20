import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useMediaRecorder, type MediaRecorderController } from "../useMediaRecorder";
import { isNativePlatform, recordNativeVideo, type NativeVideoResult } from "../../services/nativeVideo";
import { MAX_VIDEO_DURATION_SECONDS, VIDEO_BITS_PER_SECOND } from "../../constants/video";

/* ────────────────────────────────────────────
 * Hook-level tests for the capture controller.
 *
 * These deliberately target the seams the component tests cannot reach:
 * the native Capacitor path, camera flipping, the blob MIME derivation, the
 * fisheye capture frame rate, and the per-platform permission copy. Anything
 * observable purely through the rendered viewfinder chrome lives in
 * src/components/__tests__/VideoRecorder.test.tsx instead.
 * ──────────────────────────────────────────── */

vi.mock("../../services/nativeVideo", () => ({
  isNativePlatform: vi.fn(() => false),
  recordNativeVideo: vi.fn(),
}));

const mockIsNativePlatform = vi.mocked(isNativePlatform);
const mockRecordNativeVideo = vi.mocked(recordNativeVideo);
const mockGetUserMedia = vi.fn();

/**
 * Payload for a chunk representing a *real* take. It must exceed
 * MIN_UPLOAD_BYTES (1 KB), because the recorder now rejects anything at or
 * below that as a failed encode — the iOS Safari failure mode where the
 * encoder yields a technically non-empty but unusable file. A 10-byte fixture
 * would exercise the rejection path in every test that meant to record
 * successfully.
 */
const CLIP_BYTES = "clip-bytes".padEnd(2048, ".");

/**
 * A `MediaStreamTrack`-shaped fake. The real object always carries the
 * event-target pair (used to detect a revoked camera) and `getSettings()`,
 * so the fake does too — a thinner one only proves the code survives thin
 * fakes.
 */
function fakeTrack(kind: "video" | "audio", settings: MediaTrackSettings = { frameRate: 30 }) {
  return {
    kind,
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getSettings: (): MediaTrackSettings => settings,
  };
}
type FakeTrack = ReturnType<typeof fakeTrack>;

function fakeStream(videoTracks: FakeTrack[], audioTracks: FakeTrack[] = [fakeTrack("audio")]) {
  return {
    getTracks: () => [...videoTracks, ...audioTracks],
    getVideoTracks: () => videoTracks,
    getAudioTracks: () => audioTracks,
  };
}

/** MediaRecorder stand-in whose container/codec support is configurable per test. */
class FakeRecorder {
  static supported: readonly string[] = [];
  static latest: FakeRecorder | null = null;
  static isTypeSupported(type: string): boolean {
    return FakeRecorder.supported.includes(type);
  }

  readonly mimeType: string;
  readonly videoBitsPerSecond: number | undefined;
  readonly recordedStream: unknown;
  state: "inactive" | "recording" = "inactive";
  stopCount = 0;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(stream: unknown, options?: MediaRecorderOptions) {
    this.recordedStream = stream;
    // Spec behaviour: an instance always reports the type it settled on.
    this.mimeType = options?.mimeType ?? "";
    this.videoBitsPerSecond = options?.videoBitsPerSecond;
    FakeRecorder.latest = this;
  }

  /** Timeslice the hook asked for, or undefined if it passed none. */
  startTimeslice: number | undefined = undefined;

  start(timeslice?: number): void {
    this.startTimeslice = timeslice;
    this.state = "recording";
  }

  stop(): void {
    this.stopCount += 1;
    this.state = "inactive";
    this.onstop?.();
  }

  /** Deliver a chunk exactly like a real recorder does mid-take. */
  emit(chunk: Blob): void {
    this.ondataavailable?.({ data: chunk });
  }
}

function latestRecorder(): FakeRecorder {
  const mr = FakeRecorder.latest;
  if (!mr) throw new Error("no MediaRecorder was constructed");
  return mr;
}

interface HookView {
  result: { current: MediaRecorderController };
  unmount: () => void;
  onRecorded: ReturnType<typeof vi.fn<(blob: Blob | null) => void>>;
}

function mountRecorder(): HookView {
  const onRecorded = vi.fn<(blob: Blob | null) => void>();
  const { result, unmount } = renderHook(() => useMediaRecorder(onRecorded));
  return { result, unmount, onRecorded };
}

async function openCamera(view: HookView): Promise<void> {
  await act(async () => {
    await view.result.current.openCamera();
  });
}

/**
 * A canvas whose `captureStream` is a spy, plus the stream it hands back —
 * the shape every fisheye-recording assertion needs.
 */
function fakeFisheyeCanvas() {
  const canvasStream = { addTrack: vi.fn(), getTracks: () => [], getAudioTracks: () => [] };
  const captureStream = vi.fn(() => canvasStream);
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "captureStream", { configurable: true, value: captureStream });
  return { canvas, canvasStream, captureStream };
}

/** Hand the hook a fisheye canvas, arm the effect, and start a take. */
function startFisheyeTake(view: HookView, canvas: HTMLCanvasElement): void {
  act(() => {
    view.result.current.setFisheyeCanvas(canvas);
    view.result.current.toggleFisheye();
  });
  act(() => view.result.current.startRec());
}

/** Shadow navigator.userAgent for one test; returns the restore function. */
function stubUserAgent(ua: string): () => void {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: ua });
  return () => Reflect.deleteProperty(navigator, "userAgent");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserMedia.mockReset();
  mockIsNativePlatform.mockReturnValue(false);
  FakeRecorder.supported = [];
  FakeRecorder.latest = null;
  Object.defineProperty(navigator, "mediaDevices", {
    writable: true,
    configurable: true,
    value: { getUserMedia: mockGetUserMedia },
  });
  (globalThis as unknown as Record<string, unknown>).MediaRecorder = FakeRecorder;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMediaRecorder", () => {
  it("requests portrait HD from the rear camera with voice DSP disabled", async () => {
    mockGetUserMedia.mockResolvedValue(fakeStream([fakeTrack("video")]));
    const view = mountRecorder();
    await openCamera(view);

    expect(view.result.current.state).toBe("preview");
    expect(view.result.current.facingMode).toBe("environment");
    expect(mockGetUserMedia).toHaveBeenCalledWith({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1080 },
        height: { ideal: 1920 },
        frameRate: { ideal: 60 },
      },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  });

  it("records at the shared bitrate so native and web clips match", async () => {
    mockGetUserMedia.mockResolvedValue(fakeStream([fakeTrack("video")]));
    const view = mountRecorder();
    await openCamera(view);

    act(() => view.result.current.startRec());

    expect(latestRecorder().videoBitsPerSecond).toBe(VIDEO_BITS_PER_SECOND);
    expect(view.result.current.state).toBe("recording");
  });

  it("flips the camera, stopping the previous tracks before re-acquiring", async () => {
    const firstTrack = fakeTrack("video");
    const secondTrack = fakeTrack("video");
    let stopsBeforeReacquire = -1;
    mockGetUserMedia
      .mockResolvedValueOnce(fakeStream([firstTrack]))
      .mockImplementationOnce(() => {
        // The old device must already be released when the new one is asked
        // for — otherwise the second acquisition fights the first for the camera.
        stopsBeforeReacquire = firstTrack.stop.mock.calls.length;
        return Promise.resolve(fakeStream([secondTrack]));
      })
      .mockResolvedValueOnce(fakeStream([fakeTrack("video")]));

    const view = mountRecorder();
    await openCamera(view);

    await act(async () => {
      view.result.current.flipCamera();
    });
    expect(view.result.current.facingMode).toBe("user");
    expect(stopsBeforeReacquire).toBeGreaterThan(0);
    expect(mockGetUserMedia).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ video: expect.objectContaining({ facingMode: { ideal: "user" } }) }),
    );

    await act(async () => {
      view.result.current.flipCamera();
    });
    expect(view.result.current.facingMode).toBe("environment");
    expect(secondTrack.stop).toHaveBeenCalled();
    expect(mockGetUserMedia).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ video: expect.objectContaining({ facingMode: { ideal: "environment" } }) }),
    );
  });

  /**
   * The Safari corruption fix. Before this, the blob was hardcoded to
   * "video/webm" — Safari records H.264/MP4, so MP4 bytes shipped to Storage
   * labelled WebM and every iOS-web clip was unplayable.
   */
  const BLOB_TYPE_CASES = [
    {
      name: "uses the recorder's own container, codec parameters stripped",
      supported: ["video/mp4;codecs=h264"],
      chunkType: "video/webm",
      expected: "video/mp4",
    },
    {
      name: "falls back to the first chunk's type when the recorder reports none",
      supported: [],
      chunkType: "video/mp4",
      expected: "video/mp4",
    },
    {
      name: "falls back to WebM when neither recorder nor chunk declares a type",
      supported: [],
      chunkType: "",
      expected: "video/webm",
    },
  ] as const;

  for (const { name, supported, chunkType, expected } of BLOB_TYPE_CASES) {
    it(`stamps the finished blob — ${name}`, async () => {
      FakeRecorder.supported = supported;
      mockGetUserMedia.mockResolvedValue(fakeStream([fakeTrack("video")]));
      const view = mountRecorder();
      await openCamera(view);

      act(() => view.result.current.startRec());
      act(() => latestRecorder().emit(new Blob([CLIP_BYTES], chunkType ? { type: chunkType } : undefined)));
      act(() => view.result.current.stopRec());

      await waitFor(() => expect(view.onRecorded).toHaveBeenCalled());
      const [blob] = view.onRecorded.mock.calls[0];
      expect(blob?.type).toBe(expected);
      expect(view.result.current.blobUrl).toBeTruthy();
    });
  }

  // ── iOS Safari capture reliability (ported from PR #464) ──
  // These three guard the failure modes behind "black video" and "Video is
  // too small to upload" on iPhone Safari. None can be reproduced in JSDOM
  // with a real MediaRecorder, so they are asserted against the fake at the
  // exact seams the fixes touch.

  it("flushes a chunk every second so short iOS takes are not lost", async () => {
    // Without a timeslice the recorder may buffer the whole take and
    // materialise nothing at stop() — the empty-file bug on iOS Safari.
    mockGetUserMedia.mockResolvedValue(fakeStream([fakeTrack("video")]));
    const view = mountRecorder();
    await openCamera(view);

    act(() => view.result.current.startRec());

    expect(latestRecorder().startTimeslice).toBe(1000);
  });

  it("rejects a non-empty take that is too small to upload", async () => {
    // A 1-byte encode is the other iOS Safari failure: technically non-empty,
    // but storage.rules requires > 1 KB, so it would surface a confusing
    // "Video is too small to upload" long after the user left the camera.
    mockGetUserMedia.mockResolvedValue(fakeStream([fakeTrack("video")]));
    const view = mountRecorder();
    await openCamera(view);

    act(() => view.result.current.startRec());
    act(() => latestRecorder().emit(new Blob(["x"], { type: "video/mp4" })));
    act(() => view.result.current.stopRec());

    await waitFor(() => expect(view.onRecorded).toHaveBeenCalledWith(null));
    // Back to idle with an actionable message, not "done" with a dead clip.
    expect(view.result.current.state).toBe("idle");
    expect(view.result.current.cameraError).toMatch(/recording failed on this device/i);
    expect(view.result.current.blobUrl).toBeNull();
  });

  it("accepts a take of exactly the minimum upload size plus one byte", async () => {
    // The bound is exclusive in storage.rules (`size > 1024`), so 1025 is the
    // first acceptable size. Pins the boundary against an off-by-one.
    mockGetUserMedia.mockResolvedValue(fakeStream([fakeTrack("video")]));
    const view = mountRecorder();
    await openCamera(view);

    act(() => view.result.current.startRec());
    act(() => latestRecorder().emit(new Blob(["y".repeat(1025)], { type: "video/mp4" })));
    act(() => view.result.current.stopRec());

    await waitFor(() => expect(view.onRecorded).toHaveBeenCalled());
    const [blob] = view.onRecorded.mock.calls[0];
    expect(blob?.size).toBe(1025);
    expect(view.result.current.state).toBe("done");
  });

  it("releases the camera and mic when a take produces no bytes", async () => {
    const video = fakeTrack("video");
    const audio = fakeTrack("audio");
    mockGetUserMedia.mockResolvedValue(fakeStream([video], [audio]));
    const view = mountRecorder();
    await openCamera(view);

    act(() => view.result.current.startRec());
    act(() => view.result.current.stopRec());

    expect(view.onRecorded).toHaveBeenCalledWith(null);
    expect(view.result.current.blobUrl).toBeNull();
    // The leak: the zero-byte path used to bail before teardown, leaving the
    // recording indicator lit until the component unmounted.
    expect(video.stop).toHaveBeenCalled();
    expect(audio.stop).toHaveBeenCalled();
  });

  it("kills a live recorder on unmount without delivering a take", async () => {
    mockGetUserMedia.mockResolvedValue(fakeStream([fakeTrack("video")]));
    const view = mountRecorder();
    await openCamera(view);

    act(() => view.result.current.startRec());
    const recorder = latestRecorder();
    expect(recorder.state).toBe("recording");

    view.unmount();

    expect(recorder.stopCount).toBe(1);
    expect(recorder.state).toBe("inactive");
    expect(view.onRecorded).not.toHaveBeenCalled();
  });

  const FRAME_RATE_CASES = [
    { name: "the camera's reported rate", settings: { frameRate: 60 }, hasVideoTrack: true, expected: 60 },
    { name: "30fps when the track reports no rate", settings: {}, hasVideoTrack: true, expected: 30 },
    { name: "30fps when the stream carries no video track", settings: {}, hasVideoTrack: false, expected: 30 },
  ] as const;

  for (const { name, settings, hasVideoTrack, expected } of FRAME_RATE_CASES) {
    it(`captures the fisheye canvas at ${name}`, async () => {
      const audio = fakeTrack("audio");
      const videoTracks = hasVideoTrack ? [fakeTrack("video", settings)] : [];
      mockGetUserMedia.mockResolvedValue(fakeStream(videoTracks, [audio]));
      const { canvas, canvasStream, captureStream } = fakeFisheyeCanvas();

      const view = mountRecorder();
      await openCamera(view);
      startFisheyeTake(view, canvas);

      expect(captureStream).toHaveBeenCalledWith(expected);
      // Audio must be grafted onto the canvas stream or the fisheye take is silent.
      expect(canvasStream.addTrack).toHaveBeenCalledWith(audio);
    });
  }

  const IOS_SAFARI_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";

  it("records the raw camera stream instead of the fisheye canvas on iOS Safari", async () => {
    // WebGL-canvas captureStream into MediaRecorder is unreliable on iOS
    // Safari and yields black/near-empty files. Fisheye stays a live preview
    // there; the clip itself comes from the camera so the user gets real video.
    const restoreUA = stubUserAgent(IOS_SAFARI_UA);
    try {
      const camera = fakeStream([fakeTrack("video")]);
      mockGetUserMedia.mockResolvedValue(camera);
      const { canvas, captureStream } = fakeFisheyeCanvas();

      const view = mountRecorder();
      await openCamera(view);
      startFisheyeTake(view, canvas);

      expect(captureStream).not.toHaveBeenCalled();
      expect(latestRecorder().recordedStream).toBe(camera);
      // The effect stays armed for the viewfinder — only recording bypasses it.
      expect(view.result.current.fisheyeOn).toBe(true);
    } finally {
      restoreUA();
    }
  });

  it("still captures the fisheye canvas when the browser reports no user agent", async () => {
    // A blank UA must not be mistaken for iOS Safari — that would silently
    // disable the fisheye effect for every take on such a browser.
    const restoreUA = stubUserAgent("");
    try {
      mockGetUserMedia.mockResolvedValue(fakeStream([fakeTrack("video")]));
      const { canvas, captureStream } = fakeFisheyeCanvas();

      const view = mountRecorder();
      await openCamera(view);
      startFisheyeTake(view, canvas);

      expect(captureStream).toHaveBeenCalled();
    } finally {
      restoreUA();
    }
  });

  const PERMISSION_HINT_CASES = [
    {
      name: "iOS Safari sends the user to system Settings",
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
      hint: "Open Settings → Safari → Camera and allow access, then reload.",
    },
    {
      // iOS camera access is granted per APP, so naming the wrong browser is
      // not a cosmetic slip — the user follows it exactly, nothing changes,
      // and the app reads as broken. Every iOS browser also carries a
      // `Safari/` token, which is what made this easy to get wrong.
      name: "iOS Chrome is sent to Chrome's settings, not Safari's",
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1",
      hint: "Open Settings → Chrome → Camera and allow access, then reload.",
    },
    {
      name: "iOS Firefox is sent to Firefox's settings",
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15",
      hint: "Open Settings → Firefox → Camera and allow access, then reload.",
    },
    {
      name: "iOS Edge is sent to Edge's settings",
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/120.0.0.0 Mobile/15E148 Safari/605.1.15",
      hint: "Open Settings → Edge → Camera and allow access, then reload.",
    },
    {
      name: "desktop Safari names its own address bar",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      hint: "Click the camera icon in Safari's address bar and allow access.",
    },
    {
      name: "Chrome is not mistaken for Safari despite its Safari token",
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      hint: "Tap the lock/camera icon in your address bar and allow access.",
    },
    {
      name: "an empty user agent gets the generic hint",
      ua: "",
      hint: "Tap the lock/camera icon in your address bar and allow access.",
    },
  ] as const;

  for (const { name, ua, hint } of PERMISSION_HINT_CASES) {
    it(`tailors the denied-permission recovery hint — ${name}`, async () => {
      const restore = stubUserAgent(ua);
      try {
        mockGetUserMedia.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
        const view = mountRecorder();
        await openCamera(view);
        expect(view.result.current.cameraError).toBe(`Camera access denied. ${hint}`);
        expect(view.result.current.state).toBe("idle");
      } finally {
        restore();
      }
    });
  }

  it("falls back to generic permission copy when there is no navigator", async () => {
    const realNavigator = globalThis.navigator;
    // One-shot: the very next `navigator` read sees nothing (the non-browser
    // guard in permissionHint), then the global is itself again. A wider
    // window would just break React.
    let armed = false;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      get: () => {
        if (!armed) return realNavigator;
        armed = false;
        return undefined;
      },
    });
    try {
      mockGetUserMedia.mockImplementation(() => {
        armed = true;
        return Promise.reject(new DOMException("Denied", "NotAllowedError"));
      });
      const view = mountRecorder();
      await openCamera(view);
      expect(view.result.current.cameraError).toBe(
        "Camera access denied. Check your browser permissions and try again.",
      );
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        writable: true,
        value: realNavigator,
      });
    }
  });

  it("drives the recording state on native and stops the take on abort", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockIsNativePlatform.mockReturnValue(true);
    let capturedSignal: AbortSignal | undefined;
    let started: (() => void) | undefined;
    let finish: (result: NativeVideoResult) => void = () => undefined;
    mockRecordNativeVideo.mockImplementation(
      (signal, onRecordingStarted) =>
        new Promise<NativeVideoResult>((resolve) => {
          capturedSignal = signal;
          started = onRecordingStarted;
          finish = resolve;
        }),
    );

    const view = mountRecorder();
    expect(view.result.current.isNative).toBe(true);

    act(() => {
      void view.result.current.startNativeRec();
    });
    // Previously the native take sat in "idle" with no timer and no Stop button.
    // State must flip synchronously so Stop exists during camera warm-up.
    expect(view.result.current.state).toBe("recording");
    expect(capturedSignal).toBeInstanceOf(AbortSignal);

    // The clock must NOT run during warm-up. It used to, so the on-screen
    // elapsed time led the real take by the whole plugin startup — 10+ seconds
    // behind an OS permission dialog on first launch.
    act(() => vi.advanceTimersByTime(4000));
    expect(view.result.current.seconds).toBe(0);

    // Frames start: the service invokes onRecordingStarted, and only now does
    // the displayed clock begin.
    act(() => started?.());
    act(() => vi.advanceTimersByTime(3000));
    expect(view.result.current.seconds).toBe(3);

    // The interval outlives the recording (stopRecording + fetch + destroy all
    // run after the cap), so the displayed count must saturate rather than tick
    // past the limit the way it used to — 0:21, 0:22, 0:23…
    act(() => vi.advanceTimersByTime((MAX_VIDEO_DURATION_SECONDS + 10) * 1000));
    expect(view.result.current.seconds).toBe(MAX_VIDEO_DURATION_SECONDS);

    act(() => view.result.current.stopNativeRec());
    expect(capturedSignal?.aborted).toBe(true);

    const blob = new Blob(["native-bytes"], { type: "video/mp4" });
    await act(async () => {
      finish({ blob, mimeType: "video/mp4" });
    });

    expect(view.result.current.state).toBe("done");
    expect(view.result.current.blobUrl).toBeTruthy();
    expect(view.onRecorded).toHaveBeenCalledWith(blob);
  });

  const NATIVE_FAILURE_CASES = [
    {
      name: "a user cancel returns to idle with nothing to apologise for",
      error: new DOMException("Recording cancelled", "AbortError"),
      expectedError: null,
    },
    {
      name: "a real failure surfaces a native camera error",
      error: new Error("camera in use"),
      expectedError: "Native camera error: camera in use",
    },
  ] as const;

  for (const { name, error, expectedError } of NATIVE_FAILURE_CASES) {
    it(`native capture — ${name}`, async () => {
      mockIsNativePlatform.mockReturnValue(true);
      mockRecordNativeVideo.mockRejectedValue(error);

      const view = mountRecorder();
      await act(async () => {
        await view.result.current.startNativeRec();
      });

      expect(view.result.current.state).toBe("idle");
      expect(view.result.current.cameraError).toBe(expectedError);
      expect(view.onRecorded).not.toHaveBeenCalled();
    });
  }

  describe("concurrent acquisition", () => {
    /**
     * Two overlapping acquisitions used to leave one camera live forever: both
     * cleared the pre-await teardown before either stream existed, so whichever
     * resolved LAST won `streamRef` and the other became unreachable — neither
     * `stopTracks` nor the unmount cleanup could see it, because both walk only
     * `streamRef`. Real trigger: double-tapping the flip button, which stays
     * mounted and clickable for the whole getUserMedia wait.
     */
    it("stops the superseded stream when an older acquisition resolves last", async () => {
      const first = { video: fakeTrack("video"), audio: fakeTrack("audio") };
      const second = { video: fakeTrack("video"), audio: fakeTrack("audio") };
      let resolveFirst: (s: unknown) => void = () => undefined;
      let resolveSecond: (s: unknown) => void = () => undefined;
      mockGetUserMedia
        .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
        .mockImplementationOnce(() => new Promise((r) => (resolveSecond = r)));

      const view = mountRecorder();
      act(() => {
        void view.result.current.openCamera();
        void view.result.current.openCamera();
      });

      // Newest call wins regardless of resolution order: resolve #2 first, then
      // the superseded #1.
      await act(async () => {
        resolveSecond(fakeStream([second.video], [second.audio]));
      });
      await act(async () => {
        resolveFirst(fakeStream([first.video], [first.audio]));
      });

      // The late arrival must be fully released — camera AND mic.
      expect(first.video.stop).toHaveBeenCalled();
      expect(first.audio.stop).toHaveBeenCalled();
      // ...and must not have displaced the live stream.
      expect(second.video.stop).not.toHaveBeenCalled();
      expect(view.result.current.state).toBe("preview");

      // Unmount must still reach the surviving stream.
      act(() => view.unmount());
      expect(second.video.stop).toHaveBeenCalled();
      expect(second.audio.stop).toHaveBeenCalled();
    });

    /**
     * Unmounting mid-acquisition ran the cleanup while `streamRef` was still
     * null — nothing to stop — and the in-flight promise then handed a live
     * camera to a dead component. The setter path mounts with `autoOpen`, so
     * acquisition begins the instant the recorder appears.
     */
    it("releases a stream that arrives after unmount", async () => {
      const late = { video: fakeTrack("video"), audio: fakeTrack("audio") };
      let resolveLate: (s: unknown) => void = () => undefined;
      mockGetUserMedia.mockImplementationOnce(() => new Promise((r) => (resolveLate = r)));

      const view = mountRecorder();
      act(() => {
        void view.result.current.openCamera();
      });
      act(() => view.unmount());

      await act(async () => {
        resolveLate(fakeStream([late.video], [late.audio]));
      });

      expect(late.video.stop).toHaveBeenCalled();
      expect(late.audio.stop).toHaveBeenCalled();
    });

    /**
     * The failure path needs the same staleness guard as the success path:
     * a user who navigates away while the permission dialog is up, then taps
     * Deny, would otherwise setState on an unmounted hook and surface an error
     * banner belonging to a screen that no longer exists.
     */
    it("stays quiet when a rejected acquisition lands after unmount", async () => {
      let rejectLate: (e: unknown) => void = () => undefined;
      mockGetUserMedia.mockImplementationOnce(() => new Promise((_r, reject) => (rejectLate = reject)));

      const view = mountRecorder();
      act(() => {
        void view.result.current.openCamera();
      });
      act(() => view.unmount());

      // Must not throw an unhandled rejection or warn about setState-after-unmount.
      await act(async () => {
        rejectLate(new DOMException("Not allowed", "NotAllowedError"));
      });
    });

    /**
     * `openCamera` stops the old stream before awaiting, so a rejected
     * re-acquire left a STOPPED stream reachable while the UI still read
     * "preview". `startRec` gates on `!streamRef.current`, so that guard passed
     * and built a MediaRecorder over dead tracks.
     */
    it("does not record over dead tracks after a failed re-acquire", async () => {
      const live = fakeTrack("video");
      mockGetUserMedia
        .mockResolvedValueOnce(fakeStream([live]))
        .mockRejectedValueOnce(new DOMException("Device in use", "NotReadableError"));

      const view = mountRecorder();
      await openCamera(view);
      expect(view.result.current.state).toBe("preview");

      // Flip to a camera that fails to open.
      await act(async () => {
        view.result.current.flipCamera();
      });

      expect(live.stop).toHaveBeenCalled();
      expect(view.result.current.cameraError).toMatch(/Camera unavailable/);
      // Recoverable: back to idle rather than a "preview" that cannot record.
      expect(view.result.current.state).toBe("idle");

      FakeRecorder.latest = null;
      act(() => view.result.current.startRec());
      expect(FakeRecorder.latest).toBeNull();
      expect(view.result.current.cameraError).toMatch(/no active stream/);
    });
  });
});
