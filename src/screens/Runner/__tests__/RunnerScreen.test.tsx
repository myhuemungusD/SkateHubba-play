import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { __resetCachedMqlForTest } from "../../../hooks/useReducedMotion";
import {
  LOW_RAIL_AUTHOR_PAGE,
  LOW_RAIL_CREDIT,
  LOW_RAIL_PAGE,
  SKATEBOARD_01_AUTHOR_PAGE,
  SKATEBOARD_01_CREDIT,
  SKATEBOARD_01_LICENSE,
  SKATEBOARD_01_PAGE,
} from "../../../runner/boardCredit";
import { createRunnerController } from "../../../runner/controller";
import { LATE_LOCK, RAIL_LENGTH, TRICK_POINTS } from "../../../runner/constants";
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

function rail(z = 2): Obstacle {
  return { id: 1, kind: "rail", lane: 1, z, length: RAIL_LENGTH, awarded: false, resolved: false };
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
    expect(screen.getByText(/Tap a crooked grind/)).toBeInTheDocument();
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
    expect(screen.queryByText(/Tap a crooked grind/)).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("button", { name: "Pause" }), { key: " " });
    expect(controller.getState().armed).toBeNull();
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(controller.getState().armed).toBe("crooked");
    expect(screen.getByText("CROOKED")).toBeInTheDocument();
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
    expect(screen.queryByText(/Tap a crooked grind/)).not.toBeInTheDocument();
    expect(screen.getByTestId("runner-credit")).toHaveTextContent(SKATEBOARD_01_CREDIT);
    expect(screen.getByTestId("runner-credit")).toHaveTextContent(LOW_RAIL_CREDIT);
    expect(screen.getByRole("link", { name: SKATEBOARD_01_PAGE })).toHaveAttribute("href", SKATEBOARD_01_PAGE);
    expect(screen.getByRole("link", { name: SKATEBOARD_01_AUTHOR_PAGE })).toHaveAttribute(
      "href",
      SKATEBOARD_01_AUTHOR_PAGE,
    );
    expect(screen.getAllByRole("link", { name: SKATEBOARD_01_LICENSE }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: LOW_RAIL_PAGE })).toHaveAttribute("href", LOW_RAIL_PAGE);
    expect(screen.getByRole("link", { name: LOW_RAIL_AUTHOR_PAGE })).toHaveAttribute("href", LOW_RAIL_AUTHOR_PAGE);

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

  it("shows a crooked grind, then game over, and restarts", async () => {
    const user = userEvent.setup();
    const controller = createRunnerController({ spawn: false, obstacles: [rail()] });
    const first = renderRunner(controller);
    fireEvent.keyDown(window, { key: "f" });
    act(() => {
      controller.step(0.35);
    });
    expect(controller.getState().grade).toBe("perfect");
    expect(controller.getState().popup).toBe(TRICK_POINTS.crooked.perfect);
    expect(screen.getByTestId("runner-announce")).toHaveTextContent("CROOKED GRIND");
    expect(screen.getAllByText("CROOKED GRIND")).toHaveLength(2);
    expect(screen.getByText("PERFECT")).toBeInTheDocument();
    expect(screen.getByTestId("runner-popup")).toHaveTextContent("+400");
    first.unmount();

    const crashed = createRunnerController({ spawn: false, obstacles: [rail(1)] });
    renderRunner(crashed);
    act(() => {
      crashed.step(0.7);
    });
    expect(crashed.getState().distance).toBeGreaterThan(1 + LATE_LOCK);
    fireEvent.keyDown(window, { key: "f" });
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

  it("shows the combo after a second grind in the same lane", () => {
    const controller = createRunnerController({
      spawn: false,
      obstacles: [rail(8), { id: 2, kind: "box", lane: 1, z: 20, length: 3.6, awarded: false, resolved: false }],
    });
    renderRunner(controller);
    const roll = (distance: number) => {
      act(() => {
        for (
          let i = 0;
          i < 400 && controller.getState().distance < distance && controller.getState().status === "playing";
          i += 1
        ) {
          controller.step(0.05);
        }
      });
    };
    roll(8 - 1.2);
    fireEvent.keyDown(window, { key: "f" });
    roll(8 + RAIL_LENGTH + 0.4);
    roll(20 - 1.2);
    fireEvent.keyDown(window, { key: "f" });
    roll(20.4);
    expect(controller.getState().combo).toBe(2);
    expect(screen.getByText("x1.5")).toBeInTheDocument();
  });

  it("swipes from the playfield and mounts the 3D view when WebGL exists", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) =>
      kind === "webgl" || kind === "webgl2"
        ? ({} as WebGLRenderingContext)
        : null) as typeof HTMLCanvasElement.prototype.getContext);

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
