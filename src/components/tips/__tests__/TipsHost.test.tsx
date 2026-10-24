import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { TipsContextValue } from "../../../context/TipsContext";

const { tipsValue, onboardingValue } = vi.hoisted(() => ({
  tipsValue: { current: null as unknown as TipsContextValue },
  onboardingValue: { current: { tourArmed: false, reducedMotion: true } },
}));
vi.mock("../../../context/TipsContext", () => ({ useTipsContext: () => tipsValue.current }));
vi.mock("../../../context/OnboardingContext", () => ({ useOnboardingContext: () => onboardingValue.current }));
vi.mock("../../../services/haptics", () => ({ playHaptic: vi.fn() }));

import { TipsHost, TIP_SETTLE_MS } from "../TipsHost";
import { enterTipZone, resetTipSignals, setCameraLive } from "../../../lib/tipSignals";

const markSeen = vi.fn();
function setTips(over: Partial<TipsContextValue> = {}) {
  tipsValue.current = {
    available: true,
    ready: true,
    disabled: false,
    seen: [],
    markSeen,
    setDisabled: vi.fn(),
    replay: vi.fn(),
    ...over,
  };
}
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TipsHost />
    </MemoryRouter>,
  );
}
const settle = () =>
  act(() => {
    vi.advanceTimersByTime(TIP_SETTLE_MS);
  });

beforeEach(() => {
  vi.useFakeTimers();
  markSeen.mockReset();
  onboardingValue.current = { tourArmed: false, reducedMotion: true };
  resetTipSignals();
  setTips();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("TipsHost", () => {
  it("walks the game tips after the screen settles and marks the set seen", () => {
    renderAt("/game");
    expect(screen.queryByTestId("tips-host")).toBeNull();
    settle();
    expect(screen.getByText("how s.k.a.t.e. works")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAccessibleName("how s.k.a.t.e. works");
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    expect(screen.getByText("your turn")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "got it" }));
    expect(markSeen).toHaveBeenCalledWith("game");
  });

  it("closes with the x and with Escape", () => {
    renderAt("/pro");
    settle();
    fireEvent.click(screen.getByRole("button", { name: "close tips" }));
    expect(markSeen).toHaveBeenCalledWith("pro");
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(markSeen).toHaveBeenCalledTimes(2);
  });

  /**
   * Regression: the profile tips sat over the profile with only Esc or a
   * small x to clear them. A tap anywhere outside the bubble now puts the set
   * away; a tap inside it (next, the copy) never does.
   */
  it("puts the set away on a tap outside the bubble, but not on taps inside it", () => {
    const outside = document.createElement("button");
    outside.textContent = "page button";
    document.body.appendChild(outside);
    renderAt("/me");
    settle();
    fireEvent.click(screen.getByText("your page"));
    fireEvent.click(screen.getByRole("button", { name: "got it" }).closest("[data-coach-bubble]")!);
    expect(markSeen).not.toHaveBeenCalled();
    fireEvent.click(outside);
    expect(markSeen).toHaveBeenCalledWith("me");
  });

  /**
   * The outside tap puts the tips away AND still reaches what was tapped:
   * swallowing it would make the first tap on the page feel dead.
   */
  it("lets an outside tap reach the page while it puts the set away", () => {
    const onPageTap = vi.fn();
    render(
      <MemoryRouter initialEntries={["/me"]}>
        <button type="button" onClick={onPageTap}>
          like
        </button>
        <TipsHost />
      </MemoryRouter>,
    );
    settle();
    const outside = screen.getByRole("button", { name: "like" });
    const tap = new MouseEvent("click", { bubbles: true, cancelable: true });
    const notCancelled = fireEvent(outside, tap);
    expect(onPageTap).toHaveBeenCalledTimes(1);
    expect(notCancelled).toBe(true);
    expect(tap.defaultPrevented).toBe(false);
    expect(markSeen).toHaveBeenCalledTimes(1);
    expect(markSeen).toHaveBeenCalledWith("me");
  });

  it("does not listen for outside taps after it unmounts", () => {
    const { unmount } = renderAt("/me");
    settle();
    unmount();
    fireEvent.click(document.body);
    expect(markSeen).not.toHaveBeenCalled();
  });

  it("drops anchor-only tips when the hook is missing", () => {
    renderAt("/feed");
    settle();
    expect(screen.getByText("tip 1 of 1", { selector: "p" })).toBeInTheDocument();
  });

  it("rings an anchor that is on screen", () => {
    const el = document.createElement("div");
    el.setAttribute("data-tutorial", "studio-tools");
    document.body.appendChild(el);
    renderAt("/closet/studio");
    settle();
    expect(screen.getByText("tip 1 of 2", { selector: "p" })).toBeInTheDocument();
    // Step 2 is the anchored "tools" tip: the ring targets its hook.
    el.getBoundingClientRect = () =>
      ({
        top: 300,
        left: 20,
        width: 100,
        height: 40,
        bottom: 340,
        right: 120,
        x: 20,
        y: 300,
        toJSON: () => ({}),
      }) as DOMRect;
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    expect(screen.getByText("tools")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(screen.getByTestId("spotlight-cutout")).toBeInTheDocument();
  });

  it("prefers an open zone over the route", () => {
    renderAt("/map");
    act(() => {
      enterTipZone("addspot");
    });
    settle();
    expect(screen.getByText("add a spot")).toBeInTheDocument();
  });

  it.each([
    ["unavailable", { available: false }],
    ["loading", { ready: false }],
    ["switched off", { disabled: true }],
    ["already seen", { seen: ["lobby"] }],
  ])("stays hidden when %s", (_label, over) => {
    setTips(over);
    renderAt("/lobby");
    settle();
    expect(screen.queryByTestId("tips-host")).toBeNull();
  });

  it("stays hidden on screens with no tips, during the tour, and while the camera is live", () => {
    const { unmount } = renderAt("/privacy");
    settle();
    expect(screen.queryByTestId("tips-host")).toBeNull();
    unmount();
    onboardingValue.current = { tourArmed: true, reducedMotion: false };
    const second = renderAt("/lobby");
    settle();
    expect(screen.queryByTestId("tips-host")).toBeNull();
    second.unmount();
    onboardingValue.current = { tourArmed: false, reducedMotion: false };
    setCameraLive(true);
    renderAt("/game");
    settle();
    expect(screen.queryByTestId("tips-host")).toBeNull();
  });

  it("ignores an unknown zone id", () => {
    enterTipZone("nope");
    renderAt("/lobby");
    settle();
    expect(screen.queryByTestId("tips-host")).toBeNull();
  });
});
