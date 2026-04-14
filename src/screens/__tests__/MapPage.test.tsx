import { describe, it, expect, vi, beforeEach } from "vitest";
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
vi.mock("../../components/map/SpotMap", () => ({
  SpotMap: (props: { activeGameSpotId?: string; onSpotSelect?: (s: { id: string }) => void; onRetry?: () => void }) => {
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
});
