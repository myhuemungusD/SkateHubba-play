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
    // Fake the warm-up retry timer so it can't fire inside a later test.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    lenses.mockResolvedValue([]);
    const { container, rerender } = render(<NativeCameraControls active={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<NativeCameraControls active />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  // The warm-up retry and the unmount guard used to be covered only when the
  // test above leaked a real 400ms timer that fired before the worker moved on
  // (load dependent), so pin both paths here with fake timers.
  it("retries the lens probe once the camera has warmed up", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    lenses.mockResolvedValueOnce([]).mockResolvedValueOnce([1, 2]);
    render(<NativeCameraControls active />);
    await act(async () => {});
    expect(lenses).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "1x lens" })).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(lenses).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "1x lens" })).toBeInTheDocument();
  });

  it("drops a lens probe that resolves after unmount", async () => {
    let resolveProbe: (l: number[]) => void = () => {};
    lenses.mockReturnValueOnce(new Promise<number[]>((r) => (resolveProbe = r)));
    const { unmount, container } = render(<NativeCameraControls active />);
    unmount();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => resolveProbe([]));
    // Cancelled: no retry is scheduled and nothing renders.
    expect(vi.getTimerCount()).toBe(0);
    expect(lenses).toHaveBeenCalledTimes(1);
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
