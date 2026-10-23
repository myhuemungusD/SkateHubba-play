import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";

const mockGetSpotsNearby = vi.fn();
vi.mock("../../../services/spots", () => ({
  NEARBY_RADIUS_KM: 10,
  getSpotsNearby: (...args: unknown[]) => mockGetSpotsNearby(...args),
}));
vi.mock("../../../services/logger", () => ({ logger: { warn: vi.fn() } }));

import { MapListFallback } from "../MapListFallback";

const spot = {
  id: "spot-1",
  name: "Courthouse Ledges",
  isVerified: false,
  obstacles: ["ledge"],
  distanceKm: 0.4,
  latitude: 0,
  longitude: 0,
};

describe("MapListFallback", () => {
  it("lists nearby spots without the map and opens a spot's page on tap", async () => {
    mockGetSpotsNearby.mockResolvedValueOnce([spot]);
    const onBack = vi.fn();
    render(
      <MemoryRouter initialEntries={["/map"]}>
        <Routes>
          <Route path="/map" element={<MapListFallback userLocation={{ lat: 1, lng: 2 }} onBack={onBack} />} />
          <Route path="/spots/:id" element={<p>spot page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Spots near you" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /Courthouse Ledges/ }));
    expect(screen.getByText("spot page")).toBeInTheDocument();
  });

  it("goes back to the map from the header chevron", async () => {
    const onBack = vi.fn();
    render(
      <MemoryRouter>
        <MapListFallback userLocation={null} onBack={onBack} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Back to map" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
