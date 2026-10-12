import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { __resetCachedMqlForTest } from "../../../hooks/useReducedMotion";
import { createRunnerController } from "../../../runner/controller";
import { RAIL_LENGTH } from "../../../runner/constants";
import type { Obstacle } from "../../../runner/types";
import { RunnerScreen } from "../RunnerScreen";

vi.mock("../../../runner/view/RunnerWorld", () => ({
  RunnerWorld: () => <div data-testid="runner-world" />,
}));

function installMatchMedia(matches: boolean): void {
  __resetCachedMqlForTest();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

function setVisibility(value: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => value,
  });
}

function renderRunner(controller?: ReturnType<typeof createRunnerController>) {
  return render(
    <MemoryRouter>
      <RunnerScreen controller={controller} />
    </MemoryRouter>,
  );
}

function rail(): Obstacle {
  return { id: 1, kind: "rail", lane: 1, z: 2, length: RAIL_LENGTH, awarded: false, resolved: false };
}

describe("RunnerScreen", () => {
  beforeEach(() => {
    installMatchMedia(false);
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    document.body.style.overflow = "auto";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    __resetCachedMqlForTest();
    setVisibility("visible");
  });

  it("shows the score, the hint, and a pause control, and locks page scroll", () => {
    const { unmount } = renderRunner();
    expect(screen.getByRole("heading", { name: "Skate Runner" })).toBeInTheDocument();
    expect(screen.getByTestId("runner-score")).toHaveTextContent("0");
    expect(screen.getByText(/Up ollies/)).toBeInTheDocument();
    expect(screen.getByTestId("runner-no-webgl")).toBeInTheDocument();
    expect(screen.queryByText(/S\.K\.A\.T\.E\. letters/)).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("changes lanes from the keyboard and ignores repeats, typing, and space on a button", () => {
    const controller = createRunnerController({ spawn: false });
    renderRunner(controller);

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByTestId("runner-announce")).toHaveTextContent("Left lane");
    fireEvent.keyDown(window, { key: "ArrowLeft", repeat: true });
    expect(controller.getState().lane).toBe(0);

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(controller.getState().lane).toBe(0);
    input.remove();

    fireEvent.keyDown(window, { key: "q" });
    expect(controller.getState().lane).toBe(0);
    expect(screen.queryByText(/Up ollies/)).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("button", { name: "Pause" }), { key: " " });
    expect(controller.getState().ollie).toBe(-1);
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(controller.getState().ollie).toBeGreaterThanOrEqual(0);
    act(() => {
      controller.step(1);
    });
    fireEvent.keyDown(window, { key: "s" });
    expect(controller.getState().duck).toBeGreaterThanOrEqual(0);
  });

  it("pauses from the button, Escape, and hiding the page, then resumes", async () => {
    const user = userEvent.setup();
    const controller = createRunnerController({ spawn: false });
    renderRunner(controller);
    act(() => {
      controller.step(0.2);
    });

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.queryByText(/Up ollies/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(controller.getState().status).toBe("paused");
    fireEvent.keyDown(window, { key: "p" });
    expect(controller.getState().status).toBe("playing");

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(controller.getState().status).toBe("playing");

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(controller.getState().status).toBe("paused");
  });

  it("starts paused when the player asked for reduced motion", async () => {
    installMatchMedia(true);
    const user = userEvent.setup();
    renderRunner();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByTestId("runner-score")).toHaveTextContent("0");
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("shows a boardslide, then game over, and restarts", async () => {
    const user = userEvent.setup();
    const controller = createRunnerController({ spawn: false, obstacles: [rail()] });
    const first = renderRunner(controller);
    act(() => {
      controller.step(0.3);
    });
    expect(screen.getByTestId("runner-announce")).toHaveTextContent("BOARDSLIDE");
    expect(screen.getAllByText("BOARDSLIDE")).toHaveLength(2);
    first.unmount();

    const crashed = createRunnerController({
      spawn: false,
      obstacles: [{ id: 2, kind: "barrier", lane: 1, z: 1, length: 0, awarded: false, resolved: false }],
    });
    renderRunner(crashed);
    act(() => {
      crashed.step(0.3);
    });
    expect(screen.getByRole("dialog", { name: "Game over" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(crashed.getState().status).toBe("gameover");
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(crashed.getState().status).toBe("gameover");

    await user.click(screen.getByRole("button", { name: "Play again" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(crashed.getState().distance).toBe(0);
    expect(screen.getByRole("link", { name: "Exit" })).toHaveAttribute("href", "/");
  });

  it("swipes from the playfield and mounts the 3D view when WebGL exists", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) =>
      kind === "webgl" || kind === "webgl2" ? ({} as WebGLRenderingContext) : null) as typeof HTMLCanvasElement.prototype.getContext);

    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frame = cb;
      return 1;
    });

    const controller = createRunnerController({ spawn: false });
    renderRunner(controller);
    expect(screen.getByTestId("runner-world")).toBeInTheDocument();

    const root = screen.getByTestId("runner-screen");
    fireEvent.touchStart(root, { changedTouches: [{ clientX: 200, clientY: 220, identifier: 1 }] });
    fireEvent.touchMove(root, { changedTouches: [{ clientX: 280, clientY: 220, identifier: 1 }] });
    expect(controller.getState().lane).toBe(2);

    act(() => {
      frame?.(1_000);
      frame?.(1_700);
    });
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("counts frames in the sim loop when there is no WebGL", () => {
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frame = cb;
      return 1;
    });
    renderRunner(createRunnerController({ spawn: false }));
    act(() => {
      frame?.(1_000);
      frame?.(1_600);
    });
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
