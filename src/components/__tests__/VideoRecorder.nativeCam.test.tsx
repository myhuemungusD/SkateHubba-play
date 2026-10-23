import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Native (Capacitor iOS) recorder. The plugin draws the camera BEHIND the web
 * view, so the page must be see-through from the first preview frame — build 3
 * showed a green camera dot and STOP RECORDING with nothing on screen.
 */
const hook = vi.hoisted(() => ({
  state: "recording" as string,
  openNativeCamera: vi.fn(() => Promise.resolve()),
  startNativeRec: vi.fn(() => Promise.resolve()),
  stopNativeRec: vi.fn(),
  releaseCamera: vi.fn(),
  openCamera: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../hooks/useMediaRecorder", () => ({
  isIOSSafari: () => false,
  useMediaRecorder: () => ({
    state: hook.state,
    blobUrl: null,
    seconds: 0,
    cameraError: null,
    cameraErrorDetail: null,
    isNative: true,
    facingMode: "environment",
    setVideoRef: vi.fn(),
    videoEl: null,
    fisheyeOn: false,
    toggleFisheye: vi.fn(),
    setFisheyeCanvas: vi.fn(),
    openCamera: hook.openCamera,
    flipCamera: vi.fn(),
    startRec: vi.fn(),
    stopRec: vi.fn(),
    startNativeRec: hook.startNativeRec,
    stopNativeRec: hook.stopNativeRec,
    openNativeCamera: hook.openNativeCamera,
    releaseCamera: hook.releaseCamera,
  }),
}));

import { VideoRecorder } from "../VideoRecorder";

/** The crosshair markup, byte for byte. It must never move or change look. */
const CROSSHAIR_HTML =
  '<div class="relative flex items-center justify-center">' +
  '<div class="absolute w-8 h-px bg-white/70"></div>' +
  '<div class="absolute h-8 w-px bg-white/70"></div>' +
  '<div class="w-3 h-3 rounded-full border border-white/70"></div></div>';

beforeEach(() => {
  vi.clearAllMocks();
  hook.state = "recording";
});

describe("VideoRecorder native see-through", () => {
  it("tags viewfinder ancestors while a native take runs and clears them after", () => {
    const { unmount } = render(<VideoRecorder onRecorded={vi.fn()} label="Record" />);
    const vf = screen.getByTestId("trick-viewfinder");
    expect(vf.parentElement?.classList.contains("sh-native-cam")).toBe(true);
    expect(document.documentElement.classList.contains("sh-native-cam")).toBe(true);
    expect(vf.classList.contains("sh-native-cam")).toBe(false);
    unmount();
    expect(document.documentElement.classList.contains("sh-native-cam")).toBe(false);
    expect(document.body.classList.contains("sh-native-cam")).toBe(false);
  });

  it("is see-through during the live preview too, before Record is tapped", () => {
    hook.state = "preview";
    render(<VideoRecorder onRecorded={vi.fn()} label="Land Your Trick" pinControls />);
    const vf = screen.getByTestId("trick-viewfinder");
    expect(vf).toBeVisible();
    expect(vf.className).toContain("bg-transparent");
    expect(vf.className).not.toContain("bg-black");
    expect(document.body.classList.contains("sh-native-cam")).toBe(true);
    expect(document.documentElement.classList.contains("sh-native-cam")).toBe(true);
    expect(screen.getByRole("button", { name: /Record — Land Your Trick/ })).toBeEnabled();
  });

  it("keeps the crosshair exactly as it was in preview and while recording", () => {
    for (const state of ["preview", "recording"]) {
      hook.state = state;
      const { unmount } = render(<VideoRecorder onRecorded={vi.fn()} label="Record" />);
      const crosshair = screen.getByTestId("camera-crosshair");
      expect(crosshair.className).toBe("absolute inset-0 flex items-center justify-center pointer-events-none");
      expect(crosshair.innerHTML).toBe(CROSSHAIR_HTML);
      expect(crosshair.parentElement).toBe(screen.getByTestId("trick-viewfinder"));
      unmount();
    }
  });

  it("does not tag anything before the camera is up", () => {
    hook.state = "idle";
    render(<VideoRecorder onRecorded={vi.fn()} label="Record" />);
    expect(document.documentElement.classList.contains("sh-native-cam")).toBe(false);
    expect(screen.getByTestId("trick-viewfinder").className).toContain("bg-black");
  });

  it("opens the live preview on screen entry, with no tap", () => {
    hook.state = "idle";
    render(<VideoRecorder onRecorded={vi.fn()} label="Record" />);
    expect(hook.openNativeCamera).toHaveBeenCalledTimes(1);
    expect(hook.openCamera).not.toHaveBeenCalled();
  });

  it("Open Camera brings the native preview back instead of starting a take", async () => {
    hook.state = "idle";
    render(<VideoRecorder onRecorded={vi.fn()} label="Record" />);
    hook.openNativeCamera.mockClear();
    await userEvent.click(screen.getByRole("button", { name: /Open Camera/ }));
    expect(hook.openNativeCamera).toHaveBeenCalledTimes(1);
    expect(hook.startNativeRec).not.toHaveBeenCalled();
  });

  it("Record starts capture on the preview that is already live", async () => {
    hook.state = "preview";
    render(<VideoRecorder onRecorded={vi.fn()} label="Record" />);
    await userEvent.click(screen.getByRole("button", { name: /Record — Record/ }));
    expect(hook.startNativeRec).toHaveBeenCalledTimes(1);
  });

  it("hides the web-only flip and fisheye toggles on native", () => {
    hook.state = "preview";
    render(<VideoRecorder onRecorded={vi.fn()} label="Record" />);
    expect(screen.queryByRole("button", { name: /Switch to front camera/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /fisheye/ })).not.toBeInTheDocument();
  });

  it("holds Record while the screen blocks it but keeps the preview live", () => {
    hook.state = "preview";
    render(<VideoRecorder onRecorded={vi.fn()} label="Record" recordBlockedLabel="Pick a trick to record" />);
    expect(screen.getByRole("button", { name: /Pick a trick to record/ })).toBeDisabled();
    expect(screen.getByTestId("camera-crosshair")).toBeInTheDocument();
  });

  it("releases the camera when the app goes to the background", () => {
    hook.state = "preview";
    render(<VideoRecorder onRecorded={vi.fn()} label="Record" />);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    try {
      document.dispatchEvent(new Event("visibilitychange"));
      expect(hook.releaseCamera).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
    }
  });

  describe("3-2-1 self-timer", () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it("is off by default — Record starts at once", async () => {
      hook.state = "preview";
      render(<VideoRecorder onRecorded={vi.fn()} label="Record" />);
      expect(screen.getByTestId("self-timer-toggle")).toHaveAttribute("aria-pressed", "false");
      await userEvent.click(screen.getByRole("button", { name: /Record — Record/ }));
      expect(hook.startNativeRec).toHaveBeenCalledTimes(1);
    });

    it("counts down off-centre, then starts capture", async () => {
      hook.state = "preview";
      render(<VideoRecorder onRecorded={vi.fn()} label="Record" />);
      await userEvent.click(screen.getByTestId("self-timer-toggle"));
      expect(screen.getByTestId("self-timer-toggle")).toHaveAttribute("aria-pressed", "true");
      await userEvent.click(screen.getByRole("button", { name: /Record — Record/ }));
      expect(screen.getByTestId("self-timer-countdown")).toHaveTextContent("3");
      expect(screen.getByRole("button", { name: /Cancel — recording in 3/ })).toBeInTheDocument();
      expect(hook.startNativeRec).not.toHaveBeenCalled();
      // The crosshair is untouched while counting.
      expect(screen.getByTestId("camera-crosshair").innerHTML).toBe(CROSSHAIR_HTML);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(hook.startNativeRec).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("self-timer-countdown")).not.toBeInTheDocument();
    });

    it("can be cancelled mid-count", async () => {
      hook.state = "preview";
      render(<VideoRecorder onRecorded={vi.fn()} label="Record" />);
      await userEvent.click(screen.getByTestId("self-timer-toggle"));
      await userEvent.click(screen.getByRole("button", { name: /Record — Record/ }));
      await userEvent.click(screen.getByRole("button", { name: /Cancel — recording in/ }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(hook.startNativeRec).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /Record — Record/ })).toBeInTheDocument();
    });
  });
});
