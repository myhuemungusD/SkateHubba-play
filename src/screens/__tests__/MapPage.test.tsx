import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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
// We assert against props the page passes in.
vi.mock("../../components/map/SpotMap", () => ({
  SpotMap: (props: { activeGameSpotId?: string; onSpotSelect?: (s: { id: string }) => void }) => (
    <div
      data-testid="spot-map-stub"
      data-active-spot={props.activeGameSpotId ?? ""}
      onClick={() => props.onSpotSelect?.({ id: "preview-spot-id" })}
    />
  ),
}));

import { MapPage } from "../MapPage";

beforeEach(() => {
  vi.clearAllMocks();
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
});
