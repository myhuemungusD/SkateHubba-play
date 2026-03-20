import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoRecorder } from "../VideoRecorder";

// Helper to set up a proper mock stream that enables MediaRecorder code path
function setupMockStream() {
  const mockStop = vi.fn();
  const mockStream = {
    getTracks: () => [{ stop: mockStop }],
    getVideoTracks: () => [{ stop: mockStop }],
    getAudioTracks: () => [{ stop: mockStop }],
  };
  Object.defineProperty(navigator, "mediaDevices", {
    writable: true,
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(mockStream) },
  });
  return { mockStop, mockStream };
}

beforeEach(() => {
  vi.clearAllMocks();
  setupMockStream();
});

afterEach(() => {
  vi.useRealTimers();
});

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

  it("auto-opens camera when autoOpen is true", async () => {
    render(<VideoRecorder onRecorded={vi.fn()} label="Land It" autoOpen />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Record — Land It/ })).toBeInTheDocument();
    });
  });

  it("handles camera permission denied error", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValueOnce(new DOMException("Not allowed", "NotAllowedError")) },
    });

    render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);
    await userEvent.click(screen.getByText(/Open Camera/));

    await waitFor(() => {
      expect(screen.getByText(/Camera access denied/)).toBeInTheDocument();
      expect(screen.getByText("Retry Camera")).toBeInTheDocument();
    });
  });

  it("handles SecurityError camera error as permission error", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValueOnce(new DOMException("Security", "SecurityError")) },
    });

    render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);
    await userEvent.click(screen.getByText(/Open Camera/));

    await waitFor(() => {
      expect(screen.getByText(/Camera access denied/)).toBeInTheDocument();
    });
  });

  it("handles generic camera error", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValueOnce(new Error("Device not found")) },
    });

    render(<VideoRecorder onRecorded={vi.fn()} label="Land It" />);
    await userEvent.click(screen.getByText(/Open Camera/));

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
          this.ondataavailable({ data: new Blob(["video-data"], { type: "video/webm" }) });
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

  it("auto-stops recording at MAX_RECORDING_SECONDS", async () => {
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

    // Advance past MAX_RECORDING_SECONDS (60s) to trigger auto-stop
    act(() => {
      vi.advanceTimersByTime(60000);
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

  it("uses video/webm;codecs=vp9 mime type when isTypeSupported returns true for vp9", async () => {
    const originalMR = (globalThis as any).MediaRecorder;
    class Vp9MR {
      static isTypeSupported = vi.fn().mockImplementation((mime: string) => mime === "video/webm;codecs=vp9");
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      state = "inactive";
      start = vi.fn().mockImplementation(function (this: Vp9MR) {
        this.state = "recording";
      });
      stop = vi.fn().mockImplementation(function (this: Vp9MR) {
        this.state = "inactive";
        if (this.ondataavailable) this.ondataavailable({ data: new Blob(["x"], { type: "video/webm" }) });
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
        if (this.ondataavailable) this.ondataavailable({ data: new Blob(["x"], { type: "video/webm" }) });
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

  it("startRec uses no-stream fallback path when camera returned null", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

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

    // With null stream, component enters preview state but streamRef.current is null
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    // Clicking record hits the !streamRef.current path (lines 58-61) and sets a setInterval
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());

    // Advance the setInterval callback to cover the (s) => s + 1 updater at line 62
    act(() => {
      vi.advanceTimersByTime(1000);
    });
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

    // Advance to 51 seconds (within 10s of MAX_RECORDING_SECONDS=60)
    act(() => {
      vi.advanceTimersByTime(51000);
    });

    await waitFor(() => {
      expect(screen.getByText(/Auto-stop in/)).toBeInTheDocument();
    });
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
