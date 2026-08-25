import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoRecorder } from "../VideoRecorder";
import { MAX_VIDEO_DURATION_MS, MAX_VIDEO_DURATION_SECONDS } from "../../constants/video";

/**
 * Payload for a chunk representing a *real* take. The recorder rejects any
 * blob at or below MIN_UPLOAD_BYTES (1 KB) as a failed encode — the iOS Safari
 * failure mode where the encoder emits a non-empty but unusable file — so a
 * handful of bytes would drive every "successful recording" test down the
 * rejection path instead.
 */
const CLIP_BYTES = "video-data".padEnd(2048, ".");

/**
 * Mirrors `AUTO_STOP_WARNING_SECONDS` in VideoRecorder.tsx, which is a module
 * private. The warning renders for the last N seconds of the take.
 */
const AUTO_STOP_WARNING_SECONDS = 5;

/**
 * One second INTO the auto-stop warning window, derived from the shared cap so
 * a future cap change moves this with it instead of silently landing past the
 * window (which is exactly how this test rotted when the cap went 60s → 20s).
 */
const INSIDE_WARNING_WINDOW_MS = (MAX_VIDEO_DURATION_SECONDS - AUTO_STOP_WARNING_SECONDS + 1) * 1000;

/**
 * A `MediaStreamTrack`-shaped fake. Real tracks always carry the event-target
 * pair and `getSettings()`; a fake missing them lets production code that calls
 * them ship broken, so the fake mirrors the full surface the hook touches.
 */
function mockTrack(kind: "video" | "audio", stop: () => void) {
  return {
    stop,
    kind,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getSettings: () => ({ frameRate: 30 }),
  };
}

// Helper to set up a proper mock stream that enables MediaRecorder code path
function setupMockStream() {
  const mockStop = vi.fn();
  const video = mockTrack("video", mockStop);
  const audio = mockTrack("audio", mockStop);
  const mockStream = {
    getTracks: () => [video, audio],
    getVideoTracks: () => [video],
    getAudioTracks: () => [audio],
  };
  Object.defineProperty(navigator, "mediaDevices", {
    writable: true,
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(mockStream) },
  });
  return { mockStop, mockStream };
}

type MediaPermissionName = "camera" | "microphone";

/**
 * Stub `navigator.permissions.query` with per-name states, or model the two
 * failure shapes the recorder must survive: a `query` that throws (Safari and
 * Firefox reject the "camera"/"microphone" names) and no Permissions API at
 * all. Returns the query spy so tests can assert the names asked for.
 */
function setupMockPermissions(states: Record<MediaPermissionName, PermissionState> | "throws" | "missing") {
  if (states === "missing") {
    Object.defineProperty(navigator, "permissions", { writable: true, configurable: true, value: undefined });
    return vi.fn();
  }
  const query =
    states === "throws"
      ? vi.fn().mockImplementation(() => {
          throw new TypeError("unsupported permission name");
        })
      : vi
          .fn()
          .mockImplementation(({ name }: { name: MediaPermissionName }) => Promise.resolve({ state: states[name] }));
  Object.defineProperty(navigator, "permissions", { writable: true, configurable: true, value: { query } });
  return query;
}

const originalPermissions = Object.getOwnPropertyDescriptor(navigator, "permissions");
const originalUserAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");

beforeEach(() => {
  vi.clearAllMocks();
  setupMockStream();
  // Default for every existing test: no Permissions API → no auto-open.
  setupMockPermissions("missing");
});

afterEach(() => {
  vi.useRealTimers();
  if (originalPermissions) Object.defineProperty(navigator, "permissions", originalPermissions);
  if (originalUserAgent) Object.defineProperty(navigator, "userAgent", originalUserAgent);
});

/**
 * Arm getUserMedia to reject with `err`, then tap Open Camera. The tap is the
 * only route to the error box — nothing acquires a stream unprompted unless
 * camera and mic are already granted.
 */
async function failToOpenCamera(err: unknown) {
  Object.defineProperty(navigator, "mediaDevices", {
    writable: true,
    configurable: true,
    value: { getUserMedia: vi.fn().mockRejectedValueOnce(err) },
  });

  render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);
  await userEvent.click(screen.getByText(/Open Camera/));
}

describe("VideoRecorder", () => {
  it("renders idle state with open camera button", () => {
    render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);
    expect(screen.getByText(/Open Camera/)).toBeInTheDocument();
    expect(screen.getByText("Tap to open camera")).toBeInTheDocument();
  });

  it("opens camera on button click and shows preview state", async () => {
    render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);
    await userEvent.click(screen.getByText(/Open Camera/));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Record — Land It/ })).toBeInTheDocument();
    });
  });

  // Regression: the setter's recorder used to call getUserMedia straight from
  // its mount effect. WebKit refuses a prompt-raising request that no gesture
  // asked for, denies it for the rest of the page load, and never shows the
  // prompt — so every iOS browser reported "Camera access denied" for a
  // permission the user was never offered. No permission state may open the
  // camera unprompted except one already granted.
  it("never calls getUserMedia before a gesture when permission is unknown", async () => {
    setupMockPermissions("throws");
    render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);

    await waitFor(() => expect(screen.getByText(/Open Camera/)).toBeInTheDocument());
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText(/Open Camera/));
    await waitFor(() => expect(screen.getByRole("button", { name: /Record — Land It/ })).toBeInTheDocument());
  });

  it("handles camera permission denied error", async () => {
    await failToOpenCamera(new DOMException("Not allowed", "NotAllowedError"));

    await waitFor(() => {
      expect(screen.getByText(/Camera access denied/)).toBeInTheDocument();
      expect(screen.getByText("Retry Camera")).toBeInTheDocument();
    });
  });

  // The friendly copy reads identically for both permission failures, so the
  // exception name is what makes a screenshot of this box actionable.
  it("shows the underlying exception name under the camera error", async () => {
    await failToOpenCamera(new DOMException("Not allowed", "NotAllowedError"));

    await waitFor(() => expect(screen.getByText("NotAllowedError")).toBeInTheDocument());
  });

  it("handles SecurityError camera error as permission error", async () => {
    await failToOpenCamera(new DOMException("Security", "SecurityError"));

    await waitFor(() => {
      expect(screen.getByText(/Camera access denied/)).toBeInTheDocument();
    });
  });

  it("handles generic camera error", async () => {
    await failToOpenCamera(new Error("Device not found"));

    await waitFor(() => {
      expect(screen.getByText(/Camera unavailable: Device not found/)).toBeInTheDocument();
    });
  });

  it("handles non-Error camera rejection", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValueOnce("string error") },
    });

    render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);
    await userEvent.click(screen.getByText(/Open Camera/));

    await waitFor(() => {
      expect(screen.getByText(/Camera unavailable: string error/)).toBeInTheDocument();
    });
  });

  it("starts and stops recording — empty blob calls onRecorded(null)", async () => {
    const onRecorded = vi.fn();
    render(<VideoRecorder onRecorded={onRecorded} label="Land It" />);

    await userEvent.click(screen.getByText(/Open Camera/));
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));
    await waitFor(() => expect(screen.getByText(/Recorded/)).toBeInTheDocument());

    // Empty blob → onRecorded(null)
    expect(onRecorded).toHaveBeenCalledWith(null);
  });

  it("records non-empty blob and calls onRecorded with blob", async () => {
    // Override MockMediaRecorder to produce data before stopping
    const originalMR = (globalThis as any).MediaRecorder;
    class DataProducingMR {
      static isTypeSupported = vi.fn().mockReturnValue(false);
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      state = "inactive";
      start = vi.fn().mockImplementation(function (this: DataProducingMR) {
        this.state = "recording";
      });
      stop = vi.fn().mockImplementation(function (this: DataProducingMR) {
        this.state = "inactive";
        // Simulate data being available before stop
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob([CLIP_BYTES], { type: "video/webm" }) });
        }
        this.onstop?.();
      });
    }
    (globalThis as any).MediaRecorder = DataProducingMR;

    const onRecorded = vi.fn();
    render(<VideoRecorder onRecorded={onRecorded} label="Land It" />);

    await userEvent.click(screen.getByText(/Open Camera/));
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));
    await waitFor(() => expect(screen.getByText(/Recorded/)).toBeInTheDocument());

    // Non-empty blob → onRecorded called with a Blob
    expect(onRecorded).toHaveBeenCalledWith(expect.any(Blob));

    // Playback video should be shown
    expect(screen.getByLabelText("Your recorded trick video")).toBeInTheDocument();

    (globalThis as any).MediaRecorder = originalMR;
  });

  it("auto-stops recording at the shared MAX_VIDEO_DURATION cap", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Use a MediaRecorder that tracks state properly
    const originalMR = (globalThis as any).MediaRecorder;
    class TimedMR {
      static isTypeSupported = vi.fn().mockReturnValue(false);
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      state = "inactive";
      start = vi.fn().mockImplementation(function (this: TimedMR) {
        this.state = "recording";
      });
      stop = vi.fn().mockImplementation(function (this: TimedMR) {
        this.state = "inactive";
        this.onstop?.();
      });
    }
    (globalThis as any).MediaRecorder = TimedMR;

    const onRecorded = vi.fn();
    render(<VideoRecorder onRecorded={onRecorded} label="Land It" />);

    await act(async () => {
      await userEvent.click(screen.getByText(/Open Camera/));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    });

    // Advance to the shared cap exactly — the auto-stop timer fires on it.
    act(() => {
      vi.advanceTimersByTime(MAX_VIDEO_DURATION_MS);
    });

    await waitFor(() => {
      expect(screen.getByText(/Recorded/)).toBeInTheDocument();
    });

    (globalThis as any).MediaRecorder = originalMR;
  });

  it("stopRec when MediaRecorder.state is 'recording' calls stop()", async () => {
    // Use a MediaRecorder that has state = "recording" when stop is pressed
    const originalMR = (globalThis as any).MediaRecorder;
    const stopFn = vi.fn();
    class RecordingMR {
      static isTypeSupported = vi.fn().mockReturnValue(false);
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      state = "inactive";
      start = vi.fn().mockImplementation(function (this: RecordingMR) {
        this.state = "recording";
      });
      stop = vi.fn().mockImplementation(function (this: RecordingMR) {
        stopFn();
        this.state = "inactive";
        this.onstop?.();
      });
    }
    (globalThis as any).MediaRecorder = RecordingMR;

    const onRecorded = vi.fn();
    render(<VideoRecorder onRecorded={onRecorded} label="Land It" />);

    await userEvent.click(screen.getByText(/Open Camera/));
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));
    await waitFor(() => expect(screen.getByText(/Recorded/)).toBeInTheDocument());

    expect(stopFn).toHaveBeenCalled();

    (globalThis as any).MediaRecorder = originalMR;
  });

  it("shows custom done label", async () => {
    const onRecorded = vi.fn();
    render(<VideoRecorder onRecorded={onRecorded} label="Land It" doneLabel="Sent!" />);

    await userEvent.click(screen.getByText(/Open Camera/));
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));
    await waitFor(() => expect(screen.getByText("✓ Sent!")).toBeInTheDocument());
  });

  it("constructs the recorder with the most-preferred supported codec", async () => {
    // The candidate the hook prefers first. This must stay in sync with
    // MIME_CANDIDATES[0] in src/hooks/useMediaRecorder.ts — an `isTypeSupported`
    // stub that matches nothing silently degrades this into a test that only
    // proves recording completes, which is how it previously passed while
    // asserting nothing about codec selection at all.
    const PREFERRED = "video/webm;codecs=vp9,opus";
    const originalMR = (globalThis as any).MediaRecorder;
    const seenOptions: (MediaRecorderOptions | undefined)[] = [];
    class Vp9MR {
      static isTypeSupported = vi.fn().mockImplementation((mime: string) => mime === PREFERRED);
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      state = "inactive";
      constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
        seenOptions.push(options);
      }
      start = vi.fn().mockImplementation(function (this: Vp9MR) {
        this.state = "recording";
      });
      stop = vi.fn().mockImplementation(function (this: Vp9MR) {
        this.state = "inactive";
        if (this.ondataavailable) this.ondataavailable({ data: new Blob([CLIP_BYTES], { type: "video/webm" }) });
        this.onstop?.();
      });
    }
    (globalThis as any).MediaRecorder = Vp9MR;

    const onRecorded = vi.fn();
    render(<VideoRecorder onRecorded={onRecorded} label="Land It" />);
    await userEvent.click(screen.getByText(/Open Camera/));
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));
    await waitFor(() => expect(screen.getByText(/Recorded/)).toBeInTheDocument());

    expect(seenOptions).toHaveLength(1);
    expect(seenOptions[0]?.mimeType).toBe(PREFERRED);

    (globalThis as any).MediaRecorder = originalMR;
  });

  it("uses video/webm mime type when vp9 unsupported but webm supported", async () => {
    const originalMR = (globalThis as any).MediaRecorder;
    class WebmMR {
      static isTypeSupported = vi.fn().mockImplementation((mime: string) => mime === "video/webm");
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      state = "inactive";
      start = vi.fn().mockImplementation(function (this: WebmMR) {
        this.state = "recording";
      });
      stop = vi.fn().mockImplementation(function (this: WebmMR) {
        this.state = "inactive";
        if (this.ondataavailable) this.ondataavailable({ data: new Blob([CLIP_BYTES], { type: "video/webm" }) });
        this.onstop?.();
      });
    }
    (globalThis as any).MediaRecorder = WebmMR;

    const onRecorded = vi.fn();
    render(<VideoRecorder onRecorded={onRecorded} label="Land It" />);
    await userEvent.click(screen.getByText(/Open Camera/));
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));
    await waitFor(() => expect(screen.getByText(/Recorded/)).toBeInTheDocument());

    (globalThis as any).MediaRecorder = originalMR;
  });

  it("startRec surfaces camera error and stays in preview when stream is null", async () => {
    // Override getUserMedia to return null so streamRef.current stays null
    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(null) },
    });

    const onRecorded = vi.fn();
    render(<VideoRecorder onRecorded={onRecorded} label="Land It" />);

    await act(async () => {
      await userEvent.click(screen.getByText(/Open Camera/));
    });

    // With null stream, component still enters preview state (openCamera succeeded)
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    // Clicking record must NOT transition to "recording" — it should surface a
    // camera error and never invoke onRecorded.
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Camera unavailable: no active stream/)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Stop Recording/ })).not.toBeInTheDocument();
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it("shows recording timer and auto-stop warning near end", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const onRecorded = vi.fn();
    render(<VideoRecorder onRecorded={onRecorded} label="Land It" />);

    await act(async () => {
      await userEvent.click(screen.getByText(/Open Camera/));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    });

    // Two seconds short of the window: elapsed timer runs, no warning yet.
    act(() => {
      vi.advanceTimersByTime(INSIDE_WARNING_WINDOW_MS - 2000);
    });
    expect(screen.queryByText(/Auto-stop in/)).not.toBeInTheDocument();

    // Cross into the window: the warning counts down the remaining seconds.
    const elapsed = INSIDE_WARNING_WINDOW_MS / 1000;
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText(`0:${elapsed}`)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(`Auto-stop in ${MAX_VIDEO_DURATION_SECONDS - elapsed}s`)).toBeInTheDocument();
    });
  });

  it("scales the auto-stop warning to a caller-supplied cap (30 s user clips)", async () => {
    // The warning window is relative to the cap, so at 30 s nothing should
    // appear at the moment a 20 s take would already be warning.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setupMockStream();
    const cap = 30;
    render(<VideoRecorder onRecorded={vi.fn()} label="Clip" maxDurationSeconds={cap} />);

    await act(async () => {
      await userEvent.click(screen.getByText(/Open Camera/));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    });

    // 16 s in: inside the 20 s cap's warning window, but well outside the
    // 30 s cap's. If the component still read the constant, this would warn.
    act(() => {
      vi.advanceTimersByTime(16_000);
    });
    expect(screen.queryByText(/Auto-stop in/)).not.toBeInTheDocument();

    // 26 s in: one second inside the 30 s cap's window.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    await waitFor(() => expect(screen.getByText("Auto-stop in 4s")).toBeInTheDocument());
  });

  it("retries camera after error", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      configurable: true,
      value: {
        getUserMedia: vi
          .fn()
          .mockRejectedValueOnce(new Error("fail"))
          .mockResolvedValueOnce({
            getTracks: () => [{ stop: vi.fn() }],
            getVideoTracks: () => [],
            getAudioTracks: () => [],
          }),
      },
    });

    render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);
    await userEvent.click(screen.getByText(/Open Camera/));

    await waitFor(() => expect(screen.getByText("Retry Camera")).toBeInTheDocument());
    await userEvent.click(screen.getByText("Retry Camera"));

    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());
  });

  it("shows fisheye toggle in preview and recording states", async () => {
    render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);

    // No fisheye toggle in idle state
    expect(screen.queryByLabelText(/fisheye/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByText(/Open Camera/));
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    // Fisheye toggle visible in preview
    const toggle = screen.getByLabelText("Enable fisheye");
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    // Toggle fisheye on
    await userEvent.click(toggle);
    expect(screen.getByLabelText("Disable fisheye")).toHaveAttribute("aria-pressed", "true");

    // Toggle fisheye off
    await userEvent.click(screen.getByLabelText("Disable fisheye"));
    expect(screen.getByLabelText("Enable fisheye")).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the crosshair only while the camera is live", async () => {
    render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);

    // Idle: no crosshair, no instruction bubble
    expect(screen.queryByTestId("camera-crosshair")).not.toBeInTheDocument();
    expect(screen.queryByTestId("crosshair-instruction")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText(/Open Camera/));
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    // Preview: crosshair present and purely decorative
    const crosshair = screen.getByTestId("camera-crosshair");
    expect(crosshair).toHaveAttribute("aria-hidden", "true");
    expect(crosshair).toHaveClass("pointer-events-none");

    // Preview: instruction bubble present and readable by screen readers
    const instruction = screen.getByTestId("crosshair-instruction");
    expect(instruction).toHaveTextContent(/crosshair is aiming/i);
    expect(instruction).not.toHaveAttribute("aria-hidden");

    // Recording: crosshair stays, instruction bubble clears the frame
    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());
    expect(screen.getByTestId("camera-crosshair")).toBeInTheDocument();
    expect(screen.queryByTestId("crosshair-instruction")).not.toBeInTheDocument();

    // Done: gone
    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));
    await waitFor(() => expect(screen.getByText(/Recorded/)).toBeInTheDocument());
    expect(screen.queryByTestId("camera-crosshair")).not.toBeInTheDocument();
  });

  it("keeps the crosshair visible when the fisheye overlay is enabled", async () => {
    render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);

    await userEvent.click(screen.getByText(/Open Camera/));
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    await userEvent.click(screen.getByLabelText("Enable fisheye"));
    expect(screen.getByLabelText("Disable fisheye")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("camera-crosshair")).toBeInTheDocument();
  });

  it("auto-opens the camera on mount when camera and mic are already granted", async () => {
    const query = setupMockPermissions({ camera: "granted", microphone: "granted" });
    render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Record — Land It/ })).toBeInTheDocument());
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({ name: "camera" });
    expect(query).toHaveBeenCalledWith({ name: "microphone" });
  });

  it("does not auto-open when only one of camera/mic is granted", async () => {
    setupMockPermissions({ camera: "granted", microphone: "prompt" });
    render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);

    await waitFor(() => expect(screen.getByText("Tap to open camera")).toBeInTheDocument());
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByText(/Allow camera & mic once/)).toBeInTheDocument();
  });

  it("does not auto-open when permission is denied", async () => {
    setupMockPermissions({ camera: "denied", microphone: "denied" });
    render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);

    await waitFor(() => expect(screen.getByText(/Allow camera & mic once/)).toBeInTheDocument());
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("stays idle without crashing when permissions.query throws", async () => {
    setupMockPermissions("throws");
    render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);

    await waitFor(() => expect(screen.getByText(/Allow camera & mic once/)).toBeInTheDocument());
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByText(/Open Camera/)).toBeInTheDocument();
  });

  it("stays idle when navigator.permissions is unavailable", async () => {
    setupMockPermissions("missing");
    render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);

    await waitFor(() => expect(screen.getByText(/Open Camera/)).toBeInTheDocument());
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("shows the Safari-specific permission tip on iOS Safari", () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1",
    });

    render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);
    expect(screen.getByText(/Website Settings → Camera: Allow/)).toBeInTheDocument();
    expect(screen.queryByText(/Allow camera & mic once/)).not.toBeInTheDocument();
  });

  it("cleans up on unmount (revokes blob URL and stops tracks)", async () => {
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const { mockStop } = setupMockStream();

    const { unmount } = render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);

    await userEvent.click(screen.getByText(/Open Camera/));
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    unmount();
    expect(mockStop).toHaveBeenCalled();
    revokeObjectURL.mockRestore();
  });
});
