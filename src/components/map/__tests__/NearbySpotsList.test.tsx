import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NearbySpot } from "../../../services/spots";
import { NearbySpotsList } from "../NearbySpotsList";

const ISO = "2026-05-01T12:00:00.000Z";

function makeNearby(overrides: Partial<NearbySpot> = {}): NearbySpot {
  const base: NearbySpot = {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    createdBy: "nearby-tester",
    name: "Hollenbeck Hubba",
    description: "ledge into bank",
    latitude: 34.0401,
    longitude: -118.2118,
    gnarRating: 4,
    bustRisk: 3,
    obstacles: ["ledge", "hubba", "manual_pad", "rail"],
    photoUrls: [],
    isVerified: false,
    isActive: true,
    createdAt: ISO,
    updatedAt: ISO,
    distanceKm: 0.35,
  };
  return { ...base, ...overrides };
}

describe("NearbySpotsList", () => {
  it("renders nothing while idle", () => {
    const { container } = render(<NearbySpotsList status="idle" spots={[]} radiusKm={10} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    { status: "no-gps" as const, text: /turn on location/i },
    { status: "loading" as const, text: /finding spots near you/i },
    { status: "error" as const, text: /couldn't load nearby spots/i },
  ])("shows a status message for $status", ({ status, text }) => {
    render(<NearbySpotsList status={status} spots={[]} radiusKm={10} onSelect={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(text);
  });

  it("shows an empty state that names the radius", () => {
    render(<NearbySpotsList status="ready" spots={[]} radiusKm={10} onSelect={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/no spots within 10 km/i);
  });

  it("lists spots with distance, a verified badge, and the first three obstacles", () => {
    const spots = [
      makeNearby(),
      makeNearby({
        id: "22222222-3333-4444-5555-666666666666",
        name: "Wallenberg",
        isVerified: true,
        obstacles: [],
        distanceKm: 2.44,
      }),
    ];
    render(<NearbySpotsList status="ready" spots={spots} radiusKm={10} onSelect={vi.fn()} />);

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("Hollenbeck Hubba");
    expect(options[0]).toHaveTextContent("350 m");
    expect(options[0]).toHaveTextContent("ledge · hubba · manual pad");
    expect(options[0]).not.toHaveTextContent("rail");
    expect(options[1]).toHaveTextContent("2.4 km");
    expect(screen.getByLabelText("Verified")).toBeInTheDocument();
  });

  it("calls onSelect with the tapped spot", async () => {
    const onSelect = vi.fn();
    const spot = makeNearby();
    render(<NearbySpotsList status="ready" spots={[spot]} radiusKm={10} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("option", { name: /hollenbeck/i }));
    expect(onSelect).toHaveBeenCalledWith(spot);
  });
});
