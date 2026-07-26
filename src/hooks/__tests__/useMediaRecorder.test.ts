import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useMediaRecorder, type MediaRecorderController } from "../useMediaRecorder";
import { isNativePlatform, recordNativeVideo, type NativeVideoResult } from "../../services/nativeVideo";
import { VIDEO_BITS_PER_SECOND } from "../../constants/video";

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

  start(): void {
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
      act(() => latestRecorder().emit(new Blob(["clip-bytes"], chunkType ? { type: chunkType } : undefined)));
      act(() => view.result.current.stopRec());

      await waitFor(() => expect(view.onRecorded).toHaveBeenCalled());
      const [blob] = view.onRecorded.mock.calls[0];
      expect(blob?.type).toBe(expected);
      expect(view.result.current.blobUrl).toBeTruthy();
    });
  }

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
      const canvasStream = { addTrack: vi.fn(), getTracks: () => [], getAudioTracks: () => [] };
      const captureStream = vi.fn(() => canvasStream);
      const canvas = document.createElement("canvas");
      Object.defineProperty(canvas, "captureStream", { configurable: true, value: captureStream });

      const view = mountRecorder();
      await openCamera(view);
      act(() => {
        view.result.current.setFisheyeCanvas(canvas);
        view.result.current.toggleFisheye();
      });
      act(() => view.result.current.startRec());

      expect(captureStream).toHaveBeenCalledWith(expected);
      // Audio must be grafted onto the canvas stream or the fisheye take is silent.
      expect(canvasStream.addTrack).toHaveBeenCalledWith(audio);
    });
  }

  const PERMISSION_HINT_CASES = [
    {
      name: "iOS sends the user to system Settings",
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
      hint: "Open Settings → Safari → Camera and allow access, then reload.",
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
    let finish: (result: NativeVideoResult) => void = () => undefined;
    mockRecordNativeVideo.mockImplementation(
      (signal) =>
        new Promise<NativeVideoResult>((resolve) => {
          capturedSignal = signal;
          finish = resolve;
        }),
    );

    const view = mountRecorder();
    expect(view.result.current.isNative).toBe(true);

    act(() => {
      void view.result.current.startNativeRec();
    });
    // Previously the native take sat in "idle" with no timer and no Stop button.
    expect(view.result.current.state).toBe("recording");
    expect(capturedSignal).toBeInstanceOf(AbortSignal);

    act(() => vi.advanceTimersByTime(3000));
    expect(view.result.current.seconds).toBe(3);

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
});
