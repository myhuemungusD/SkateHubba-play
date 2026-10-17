import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lenses, setLens, focus, qualityModes } = vi.hoisted(() => ({
  lenses: vi.fn(),
  setLens: vi.fn(async () => true),
  focus: vi.fn(async () => true),
  qualityModes: vi.fn(async () => ({ modes: [], current: "standard1080p60" })),
}));
vi.mock("../../services/nativeVideo", () => ({
  getNativeLenses: lenses,
  setNativeLens: setLens,
  focusNativeAt: focus,
  getNativeQualityModes: qualityModes,
  setNativeQuality: vi.fn(async () => true),
}));

import { NativeCameraControls } from "../NativeCameraControls";

describe("NativeCameraControls", () => {
  beforeEach(() => {
    // Enable pro camera flag for all tests
    vi.stubEnv("VITE_FEATURE_PRO_CAMERA", "true");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("renders nothing when pro camera flag is off", () => {
    vi.stubEnv("VITE_FEATURE_PRO_CAMERA", "false");
    lenses.mockResolvedValue([0.5, 1, 2]);
    const { container } = render(<NativeCameraControls active />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when inactive or when no lens info comes back", async () => {
    lenses.mockResolvedValue([]);
    const { container, rerender } = render(<NativeCameraControls active={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<NativeCameraControls active />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("switches to the 0.5x ultra-wide lens", async () => {
    lenses.mockResolvedValue([0.5, 1, 2]);
    render(<NativeCameraControls active />);
    const uw = await screen.findByRole("button", { name: "Ultra-wide lens 0.5x" });
    expect(screen.getByRole("button", { name: "1x lens" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(uw);
    expect(setLens).toHaveBeenCalledWith(0.5);
    expect(uw).toHaveAttribute("aria-pressed", "true");
  });

  it("taps to focus and holds to lock AE/AF", async () => {
    lenses.mockResolvedValue([1, 2]);
    render(<NativeCameraControls active />);
    const layer = await screen.findByTestId("native-focus-layer");
    fireEvent.pointerDown(layer, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(layer, { clientX: 10, clientY: 10 });
    expect(focus).toHaveBeenLastCalledWith(expect.any(Number), expect.any(Number), false);
    vi.useFakeTimers();
    fireEvent.pointerDown(layer, { clientX: 20, clientY: 20 });
    act(() => vi.advanceTimersByTime(600));
    fireEvent.pointerUp(layer, { clientX: 20, clientY: 20 });
    expect(focus).toHaveBeenLastCalledWith(expect.any(Number), expect.any(Number), true);
    expect(screen.getByTestId("ae-af-lock")).toBeInTheDocument();
  });
});
