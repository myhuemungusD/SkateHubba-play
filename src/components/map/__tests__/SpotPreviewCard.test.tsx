import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import type { ReactElement } from "react";
import { SpotPreviewCard } from "../SpotPreviewCard";
import type { Spot } from "../../../types/spot";

/** Echoes the current router location.search so the test can assert it. */
function LocationProbe({ tag }: { tag: string }) {
  const location = useLocation();
  return <div data-testid="dest">{`${tag}:${location.search}`}</div>;
}

const FIXTURE_SPOT: Spot = {
  id: "11111111-2222-3333-4444-555555555555",
  createdBy: "creator",
  name: "Hollenbeck Hubba",
  description: null,
  latitude: 34.0522,
  longitude: -118.2437,
  gnarRating: 3,
  bustRisk: 2,
  obstacles: ["ledge", "hubba", "stairs", "rail", "gap"],
  photoUrls: ["https://example.com/p.jpg"],
  isVerified: false,
  isActive: true,
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-10T00:00:00.000Z",
};

/**
 * Wrap the card in a MemoryRouter so useNavigate works, plus a marker
 * Route at /destination so we can assert which path the buttons navigate to
 * by reading the resulting location.
 */
function renderCard(spot: Spot, onClose: () => void = vi.fn(), activeGameSpotId?: string): ReactElement {
  return (
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="/"
          element={<SpotPreviewCard spot={spot} onClose={onClose} activeGameSpotId={activeGameSpotId} />}
        />
        <Route path="/challenge" element={<LocationProbe tag="challenge" />} />
        <Route path="/spots/:id" element={<LocationProbe tag="spots" />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("SpotPreviewCard", () => {
  it("renders the spot name + ratings + obstacles", () => {
    render(renderCard(FIXTURE_SPOT));
    expect(screen.getByText("Hollenbeck Hubba")).toBeInTheDocument();
    expect(screen.getByText("Gnar")).toBeInTheDocument();
    expect(screen.getByText("Bust")).toBeInTheDocument();
    // First few obstacles render; the rest collapse to "+N more"
    expect(screen.getByText("ledge")).toBeInTheDocument();
    expect(screen.getByText("+1 more")).toBeInTheDocument();
  });

  it("renders the photo thumbnail when photoUrls is non-empty", () => {
    render(renderCard(FIXTURE_SPOT));
    const img = screen.getByAltText(/Hollenbeck Hubba photo/) as HTMLImageElement;
    expect(img.src).toContain("https://example.com/p.jpg");
  });

  it("hides the obstacle row when there are no obstacles", () => {
    render(renderCard({ ...FIXTURE_SPOT, obstacles: [] }));
    expect(screen.queryByText("+1 more")).not.toBeInTheDocument();
  });

  it("'Challenge from here' navigates to /challenge?spot=<id>", async () => {
    render(renderCard(FIXTURE_SPOT));
    await userEvent.click(screen.getByRole("button", { name: "Challenge from here" }));
    expect(screen.getByTestId("dest").textContent).toContain(`spot=${FIXTURE_SPOT.id}`);
  });

  it("'View Spot' navigates to /spots/:id", async () => {
    render(renderCard(FIXTURE_SPOT));
    await userEvent.click(screen.getByRole("button", { name: "View Spot" }));
    expect(screen.getByTestId("dest").textContent).toContain("spots");
  });

  it("backdrop click invokes onClose", async () => {
    const onClose = vi.fn();
    render(renderCard(FIXTURE_SPOT, onClose));
    await userEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("touch-swipe-down dismisses the card", () => {
    const onClose = vi.fn();
    render(renderCard(FIXTURE_SPOT, onClose));
    const dialog = screen.getByRole("dialog");
    fireEvent.touchStart(dialog, { touches: [{ clientY: 100 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientY: 200 }] });
    expect(onClose).toHaveBeenCalled();
  });

  it("touch-swipe-up does not dismiss", () => {
    const onClose = vi.fn();
    render(renderCard(FIXTURE_SPOT, onClose));
    const dialog = screen.getByRole("dialog");
    fireEvent.touchStart(dialog, { touches: [{ clientY: 200 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientY: 195 }] });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders a Get-Directions link to Google Maps with the spot coordinates", () => {
    render(renderCard(FIXTURE_SPOT));
    const link = screen.getByRole("link", { name: /get directions to Hollenbeck Hubba/i });
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain("google.com/maps/dir/");
    expect(href).toContain(`destination=${FIXTURE_SPOT.latitude},${FIXTURE_SPOT.longitude}`);
    // Security: must open in a new tab and not leak opener.
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows the verified badge only for verified spots", () => {
    const { rerender } = render(renderCard(FIXTURE_SPOT));
    expect(screen.queryByLabelText(/verified spot/i)).toBeNull();

    rerender(
      <MemoryRouter>
        <SpotPreviewCard spot={{ ...FIXTURE_SPOT, isVerified: true }} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/verified spot/i)).toBeInTheDocument();
  });

  it("renders the active-game badge only when the spot is the active game spot", () => {
    const { rerender } = render(renderCard(FIXTURE_SPOT));
    expect(screen.queryByTestId("active-game-badge")).toBeNull();

    rerender(
      <MemoryRouter>
        <SpotPreviewCard spot={FIXTURE_SPOT} onClose={vi.fn()} activeGameSpotId={FIXTURE_SPOT.id} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("active-game-badge")).toBeInTheDocument();
    expect(screen.getByTestId("active-game-badge").textContent?.toLowerCase()).toContain("your active game");
  });

  it("swaps the photo to a graceful placeholder when the image fails to load", () => {
    render(renderCard(FIXTURE_SPOT));
    const img = screen.getByAltText(/Hollenbeck Hubba photo/);
    fireEvent.error(img);
    // The broken <img> is replaced by the placeholder with an accessible label.
    expect(screen.getByLabelText(/Photo unavailable for Hollenbeck Hubba/i)).toBeInTheDocument();
    expect(screen.queryByAltText(/Hollenbeck Hubba photo/)).toBeNull();
  });
});
