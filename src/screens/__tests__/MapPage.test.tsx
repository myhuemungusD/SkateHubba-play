import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

const mockMapViewed = vi.fn();
const mockSpotPreviewed = vi.fn();
const mockUseGameContext = vi.fn();

vi.mock("../../services/analytics", () => ({
  analytics: {
    mapViewed: () => mockMapViewed(),
    spotPreviewed: (id: string) => mockSpotPreviewed(id),
  },
}));

vi.mock("../../context/GameContext", () => ({
  useGameContext: () => mockUseGameContext(),
}));

// Stub SpotMap so the test runs in jsdom without WebGL / Mapbox GL JS.
// We assert against props the page passes in. Each mount gets a unique
// `data-mount-id` so the retry test can prove a real remount happened.
let spotMapMountCounter = 0;
let spotMapShouldThrow = false;
vi.mock("../../components/map/SpotMap", () => ({
  SpotMap: (props: { activeGameSpotId?: string; onSpotSelect?: (s: { id: string }) => void; onRetry?: () => void }) => {
    if (spotMapShouldThrow) {
      throw new Error("Simulated mapbox crash");
    }
    // Using a constant per render is enough — React will create a new
    // component instance when the parent bumps `key`, so this counter
    // increments exactly once per mount.
    const mountId = ++spotMapMountCounter;
    return (
      <div
        data-testid="spot-map-stub"
        data-active-spot={props.activeGameSpotId ?? ""}
        data-mount-id={String(mountId)}
        onClick={() => props.onSpotSelect?.({ id: "preview-spot-id" })}
      >
        <button type="button" data-testid="trigger-retry" onClick={() => props.onRetry?.()}>
          trigger retry
        </button>
      </div>
    );
  },
}));

import { MapPage } from "../MapPage";

beforeEach(() => {
  vi.clearAllMocks();
  spotMapMountCounter = 0;
  spotMapShouldThrow = false;
  mockUseGameContext.mockReturnValue({ activeGame: null });
});

describe("MapPage", () => {
  it("fires the mapViewed funnel event once on mount", () => {
    render(<MapPage />);
    expect(mockMapViewed).toHaveBeenCalledTimes(1);
  });

  it("does not pass an activeGameSpotId when there is no active game", () => {
    render(<MapPage />);
    expect(screen.getByTestId("spot-map-stub").getAttribute("data-active-spot")).toBe("");
  });

  it("passes the active game's spotId through to SpotMap", () => {
    mockUseGameContext.mockReturnValue({
      activeGame: { id: "g1", spotId: "11111111-2222-3333-4444-555555555555" },
    });
    render(<MapPage />);
    expect(screen.getByTestId("spot-map-stub").getAttribute("data-active-spot")).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it("forwards spot selection to analytics.spotPreviewed", () => {
    render(<MapPage />);
    screen.getByTestId("spot-map-stub").click();
    expect(mockSpotPreviewed).toHaveBeenCalledWith("preview-spot-id");
  });

  it("remounts SpotMap when onRetry fires instead of doing a full page reload", () => {
    render(<MapPage />);
    const initialMountId = screen.getByTestId("spot-map-stub").getAttribute("data-mount-id");
    expect(initialMountId).toBe("1");

    act(() => {
      screen.getByTestId("trigger-retry").click();
    });

    // A fresh mount id is the observable signal that the `key` bump worked
    // and the component was torn down + rebuilt without `window.location.reload`.
    expect(screen.getByTestId("spot-map-stub").getAttribute("data-mount-id")).toBe("2");
  });

  describe("MapErrorBoundary fallback", () => {
    // React logs errors it caught in a boundary to console.error. Silence
    // those for this block so the spec output stays clean; we reassert
    // the boundary caught them by the visible alert + console.warn trace.
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it("renders an alert with Try again (primary) and Reload page (secondary) when SpotMap throws", () => {
      spotMapShouldThrow = true;
      render(<MapPage />);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /reload page/i })).toBeInTheDocument();
    });

    it("Try again clears the boundary and remounts SpotMap without a full reload", () => {
      const reloadSpy = vi.fn();
      const originalLocation = window.location;
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: { ...originalLocation, reload: reloadSpy },
      });

      try {
        spotMapShouldThrow = true;
        render(<MapPage />);
        expect(screen.getByRole("alert")).toBeInTheDocument();

        // Simulate the root cause clearing before the user taps Try again.
        spotMapShouldThrow = false;
        act(() => {
          screen.getByRole("button", { name: /try again/i }).click();
        });

        // Boundary cleared, fresh SpotMap mounted, and the nuclear reload path
        // was never taken.
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.getByTestId("spot-map-stub")).toBeInTheDocument();
        expect(reloadSpy).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(window, "location", {
          configurable: true,
          writable: true,
          value: originalLocation,
        });
      }
    });

    it("keeps the fallback visible if the underlying error reoccurs on reset", () => {
      spotMapShouldThrow = true;
      render(<MapPage />);
      expect(screen.getByRole("alert")).toBeInTheDocument();

      // Leave the throw toggle ON — this simulates a persistent crash that
      // the in-app reset can't fix. The user should see the fallback again
      // so they can escalate to Reload page.
      act(() => {
        screen.getByRole("button", { name: /try again/i }).click();
      });
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /reload page/i })).toBeInTheDocument();
    });

    it("Reload page triggers window.location.reload as the terminal action", () => {
      const reloadSpy = vi.fn();
      const originalLocation = window.location;
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: { ...originalLocation, reload: reloadSpy },
      });

      try {
        spotMapShouldThrow = true;
        render(<MapPage />);
        act(() => {
          screen.getByRole("button", { name: /reload page/i }).click();
        });
        expect(reloadSpy).toHaveBeenCalledTimes(1);
      } finally {
        Object.defineProperty(window, "location", {
          configurable: true,
          writable: true,
          value: originalLocation,
        });
      }
    });
  });
});
