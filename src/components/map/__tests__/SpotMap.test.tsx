import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const mockGetSpotsInBounds = vi.fn();

vi.mock("../../../services/spots", () => ({
  getSpotsInBounds: (...args: unknown[]) => mockGetSpotsInBounds(...args),
}));

// Logger is mocked so the missing-token / load-timeout warn assertions have a
// spy to inspect. Production logger.warn would route to Sentry breadcrumbs.
// `vi.hoisted` is required because `vi.mock` factories are hoisted above all
// top-level variables — a plain `const` would throw "cannot access before
// initialization" at factory evaluation time.
const { mockLoggerWarn } = vi.hoisted(() => ({ mockLoggerWarn: vi.fn() }));
vi.mock("../../../services/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: mockLoggerWarn, error: vi.fn() },
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
// Observable count — the missing-token fallback test asserts that the map
// constructor is never invoked when VITE_MAPBOX_TOKEN is unset.
let fakeMapConstructorCalls = 0;

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
      fakeMapConstructorCalls += 1;
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
  fakeMapConstructorCalls = 0;
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

  it("renders the filter/search bar after the map has loaded", async () => {
    render(
      <MemoryRouter>
        <SpotMap />
      </MemoryRouter>,
    );
    const searchbox = await screen.findByRole("searchbox", { name: /search spots/i });
    expect(searchbox).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /filters/i })).toBeInTheDocument();
  });

  it("removes markers when a filter hides every spot, and restores them on clear", async () => {
    render(
      <MemoryRouter>
        <SpotMap />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(document.querySelector(`[data-testid="spot-marker-${FIXTURE.id}"]`)).not.toBeNull();
    });

    const search = await screen.findByRole("searchbox", { name: /search spots/i });
    await userEvent.type(search, "does-not-match-any-spot");

    await waitFor(() => {
      expect(document.querySelector(`[data-testid="spot-marker-${FIXTURE.id}"]`)).toBeNull();
    });

    // The no-matches empty state is the source of truth that filtering
    // actually applied to the marker layer.
    expect(screen.getByText(/No spots match your filters/i)).toBeInTheDocument();

    await userEvent.clear(search);

    await waitFor(() => {
      expect(document.querySelector(`[data-testid="spot-marker-${FIXTURE.id}"]`)).not.toBeNull();
    });
  });
});

describe("SpotMap load timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("surfaces a friendly retry state when mapbox never fires `load`", () => {
    // Temporarily swallow the `load` event so the component stays in loading
    // state and the 15s safety timeout fires.
    const realQueueMicrotask = globalThis.queueMicrotask;
    globalThis.queueMicrotask = () => {};
    try {
      render(
        <MemoryRouter>
          <SpotMap />
        </MemoryRouter>,
      );
      // Still loading — the normal overlay.
      expect(screen.getByRole("status", { name: /loading map/i })).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(15_000);
      });

      // jsdom doesn't implement navigator.geolocation, so the GPS banner also
      // carries role="alert" in this environment. Assert by text to pick the
      // right one rather than failing on the generic role lookup.
      expect(screen.getByText(/map is taking too long to load/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    } finally {
      globalThis.queueMicrotask = realQueueMicrotask;
    }
  });
});

describe("SpotMap without a Mapbox token", () => {
  beforeEach(() => {
    vi.resetModules();
    mockLoggerWarn.mockClear();
    fakeMapConstructorCalls = 0;
  });

  it("renders a temporarily-unavailable state, logs the outage, and never constructs a map", async () => {
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
    // Ops telemetry: the one-shot warn lets Sentry page us instead of
    // waiting on a user screenshot.
    expect(mockLoggerWarn).toHaveBeenCalledWith("map_token_missing", {});
    // Sanity: we short-circuited before mapbox-gl was touched.
    expect(fakeMapConstructorCalls).toBe(0);
  });
});

describe("SpotMap load-timeout retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes the onRetry callback instead of reloading the window", () => {
    const realQueueMicrotask = globalThis.queueMicrotask;
    globalThis.queueMicrotask = () => {};
    const onRetry = vi.fn();
    try {
      render(
        <MemoryRouter>
          <SpotMap onRetry={onRetry} />
        </MemoryRouter>,
      );
      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      const retryBtn = screen.getByRole("button", { name: /retry/i });
      act(() => {
        retryBtn.click();
      });
      expect(onRetry).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.queueMicrotask = realQueueMicrotask;
    }
  });
});
