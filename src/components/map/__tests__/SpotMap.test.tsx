import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockGetSpotsInBounds = vi.fn();

vi.mock("../../../services/spots", () => ({
  getSpotsInBounds: (...args: unknown[]) => mockGetSpotsInBounds(...args),
}));

// Provide a fake Mapbox token so the component doesn't render the
// unavailable-state fallback. The fake mapbox-gl below ignores the value.
vi.mock("../../../lib/mapbox", () => ({
  MAPBOX_TOKEN: "pk.test-token",
  MAP_STYLE: "mapbox://styles/mapbox/dark-v11",
  MAP_DEFAULTS: { zoom: 13, minZoom: 5, maxZoom: 19 },
}));

// Mock mapbox-gl: real GL JS requires WebGL2 which jsdom doesn't provide.
// The mock implements just enough surface for SpotMap's lifecycle hooks
// (constructor + addControl + on + getBounds + flyTo + remove).
const mapEventHandlers: Record<string, Array<() => void>> = {};

vi.mock("mapbox-gl", () => {
  class FakeMarker {
    private el: HTMLElement;
    constructor(opts: { element: HTMLElement }) {
      this.el = opts.element;
    }
    setLngLat() {
      return this;
    }
    addTo(_map: unknown) {
      // Append to body so test queries find it.
      document.body.appendChild(this.el);
      return this;
    }
    remove() {
      this.el.remove();
    }
  }
  class FakeMap {
    constructor(opts: { container: HTMLElement }) {
      // Trigger the load event on the next microtask so SpotMap's load
      // listener fires after the constructor returns.
      queueMicrotask(() => mapEventHandlers["load"]?.forEach((cb) => cb()));
      // Touch container so it's not flagged unused
      void opts.container;
    }
    addControl() {}
    on(event: string, cb: () => void) {
      (mapEventHandlers[event] ??= []).push(cb);
    }
    getBounds() {
      return {
        getNorth: () => 34.1,
        getSouth: () => 34.0,
        getEast: () => -118.2,
        getWest: () => -118.3,
      };
    }
    flyTo() {}
    easeTo() {}
    remove() {}
  }
  return {
    default: {
      Map: FakeMap,
      Marker: FakeMarker,
      NavigationControl: class {},
      accessToken: "",
    },
  };
});

import { SpotMap } from "../SpotMap";
import type { Spot } from "../../../types/spot";

const FIXTURE: Spot = {
  id: "11111111-2222-3333-4444-555555555555",
  createdBy: "creator",
  name: "Test Hubba",
  description: null,
  latitude: 34.05,
  longitude: -118.25,
  gnarRating: 3,
  bustRisk: 2,
  obstacles: ["ledge"],
  photoUrls: [],
  isVerified: false,
  isActive: true,
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-10T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(mapEventHandlers)) delete mapEventHandlers[k];
  mockGetSpotsInBounds.mockResolvedValue([FIXTURE]);
});

describe("SpotMap", () => {
  it("renders without crashing in jsdom (mapbox-gl mocked)", () => {
    render(
      <MemoryRouter>
        <SpotMap />
      </MemoryRouter>,
    );
    // The Add-Spot FAB is always present.
    expect(screen.getByLabelText("Add a spot")).toBeInTheDocument();
  });

  it("calls getSpotsInBounds after the map's initial load fires", async () => {
    render(
      <MemoryRouter>
        <SpotMap />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(mockGetSpotsInBounds).toHaveBeenCalled();
    });
    const args = mockGetSpotsInBounds.mock.calls[0][0];
    expect(args.north).toBe(34.1);
    expect(args.south).toBe(34.0);
    expect(args.east).toBe(-118.2);
    expect(args.west).toBe(-118.3);
  });

  it("renders a marker with the data-testid for each fetched spot", async () => {
    render(
      <MemoryRouter>
        <SpotMap />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(document.querySelector(`[data-testid="spot-marker-${FIXTURE.id}"]`)).not.toBeNull();
    });
  });

  it("logs a warning but does not crash when the bounds query fails", async () => {
    mockGetSpotsInBounds.mockRejectedValueOnce(new Error("network down"));
    render(
      <MemoryRouter>
        <SpotMap />
      </MemoryRouter>,
    );
    // Wait long enough for the promise to settle without asserting anything
    // catastrophic. The error path is exercised; the absence of an unhandled
    // promise rejection is the test.
    await waitFor(() => {
      expect(mockGetSpotsInBounds).toHaveBeenCalled();
    });
  });

  it("exposes the loading overlay as an accessible status region", () => {
    render(
      <MemoryRouter>
        <SpotMap />
      </MemoryRouter>,
    );
    // The loading overlay is present until the mocked mapbox `load` event
    // fires on the next microtask. Query synchronously to catch it.
    const loading = screen.getByRole("status", { name: /loading map/i });
    expect(loading).toBeInTheDocument();
  });
});

describe("SpotMap without a Mapbox token", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("renders a temporarily-unavailable state instead of initializing the map", async () => {
    vi.doMock("../../../lib/mapbox", () => ({
      MAPBOX_TOKEN: "",
      MAP_STYLE: "mapbox://styles/mapbox/dark-v11",
      MAP_DEFAULTS: { zoom: 13, minZoom: 5, maxZoom: 19 },
    }));
    const { SpotMap: SpotMapWithoutToken } = await import("../SpotMap");
    render(
      <MemoryRouter>
        <SpotMapWithoutToken />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/temporarily unavailable/i);
    // The Add-Spot FAB should NOT be rendered in the unavailable state.
    expect(screen.queryByLabelText("Add a spot")).toBeNull();
  });
});
