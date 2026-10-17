import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { lenses, setLens, focus } = vi.hoisted(() => ({
  lenses: vi.fn(),
  setLens: vi.fn(async () => true),
  focus: vi.fn(async () => true),
}));
vi.mock("../../services/nativeVideo", () => ({
  getNativeLenses: lenses,
  setNativeLens: setLens,
  focusNativeAt: focus,
}));

import { NativeCameraControls } from "../NativeCameraControls";

describe("NativeCameraControls", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
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
