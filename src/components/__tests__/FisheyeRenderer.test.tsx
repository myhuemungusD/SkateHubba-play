import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

/**
 * A minimal WebGL stand-in: enough of the context for compile/link to run,
 * with the status queries switchable so the driver-error paths can be hit.
 */
function fakeGL(opts: { compileOk: boolean; linkOk: boolean }) {
  return {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => opts.compileOk),
    getShaderInfoLog: vi.fn(() => "ERROR: 0:1: syntax error"),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => opts.linkOk),
    getProgramInfoLog: vi.fn(() => "link: varying mismatch"),
    deleteProgram: vi.fn(),
    useProgram: vi.fn(),
  };
}

describe("FisheyeRenderer shader errors", () => {
  let frames: FrameRequestCallback[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  function mountWith(gl: ReturnType<typeof fakeGL>) {
    // getContext is overloaded per context type; the spy is typed against the
    // last overload (WebGPU), so the fake WebGL context needs an untyped cast.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(gl as never);
    render(<FisheyeRenderer videoEl={document.createElement("video")} active={true} />);
    const first = frames.shift();
    first?.(0);
  }

  it("logs the compile error, frees the shader and retries next frame instead of drawing", async () => {
    const { logger } = await import("../../services/logger");
    const gl = fakeGL({ compileOk: false, linkOk: true });
    mountWith(gl);

    expect(logger.warn).toHaveBeenCalledWith("shader_compile_error", { info: "ERROR: 0:1: syntax error" });
    expect(gl.deleteShader).toHaveBeenCalled();
    expect(gl.createProgram).not.toHaveBeenCalled();
    expect(gl.useProgram).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
  });

  it("logs the link error, frees the program and retries next frame instead of drawing", async () => {
    const { logger } = await import("../../services/logger");
    const gl = fakeGL({ compileOk: true, linkOk: false });
    mountWith(gl);

    expect(logger.warn).toHaveBeenCalledWith("program_link_error", { info: "link: varying mismatch" });
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(gl.useProgram).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
  });
});
