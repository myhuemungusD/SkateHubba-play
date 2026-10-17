import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const hookState = { state: "recording" as string };
vi.mock("../../hooks/useMediaRecorder", () => ({
  isIOSSafari: () => false,
  useMediaRecorder: () => ({
    state: hookState.state,
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
    openCamera: vi.fn(),
    flipCamera: vi.fn(),
    startRec: vi.fn(),
    stopRec: vi.fn(),
    startNativeRec: vi.fn(),
    stopNativeRec: vi.fn(),
  }),
}));

import { VideoRecorder } from "../VideoRecorder";

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

  it("does not tag anything outside a native take", () => {
    hookState.state = "preview";
    render(<VideoRecorder onRecorded={vi.fn()} label="Record" />);
    expect(document.documentElement.classList.contains("sh-native-cam")).toBe(false);
  });
});
