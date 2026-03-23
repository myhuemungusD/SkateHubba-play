import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { FisheyeRenderer } from "../FisheyeRenderer";

vi.mock("../../services/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

describe("FisheyeRenderer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when not active", () => {
    const { container } = render(<FisheyeRenderer videoEl={null} active={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders canvas when active", () => {
    const video = document.createElement("video");
    render(<FisheyeRenderer videoEl={video} active={true} />);
    expect(screen.getByLabelText("Fisheye camera preview")).toBeInTheDocument();
  });

  it("applies className to canvas", () => {
    const video = document.createElement("video");
    render(<FisheyeRenderer videoEl={video} active={true} className="w-full" />);
    expect(screen.getByLabelText("Fisheye camera preview")).toHaveClass("w-full");
  });

  it("calls onCanvas with canvas when active and null on unmount", () => {
    const onCanvas = vi.fn();
    const video = document.createElement("video");
    const { unmount } = render(<FisheyeRenderer videoEl={video} active={true} onCanvas={onCanvas} />);

    // Should have been called with the canvas element
    expect(onCanvas).toHaveBeenCalledWith(expect.any(HTMLCanvasElement));

    unmount();
    // Should be called with null on cleanup
    expect(onCanvas).toHaveBeenCalledWith(null);
  });

  it("calls onCanvas with null when not active", () => {
    const onCanvas = vi.fn();
    render(<FisheyeRenderer videoEl={null} active={false} onCanvas={onCanvas} />);
    expect(onCanvas).toHaveBeenCalledWith(null);
  });
});
