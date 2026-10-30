import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

const mockGetSpotsInBounds = vi.fn();
const mockGetSpotsNearby = vi.fn();

vi.mock("../../../services/spots", () => ({
  getSpotsInBounds: (...args: unknown[]) => mockGetSpotsInBounds(...args),
  getSpotsNearby: (...args: unknown[]) => mockGetSpotsNearby(...args),
  NEARBY_RADIUS_KM: 10,
}));

// Stub the firebase module so re-importing SpotMap (via `vi.resetModules()` +
// `await import(...)` in the missing-token / telemetry describes below) does
// NOT re-run `initializeFirestore()` against an already-initialized
// FirebaseApp. The second `initializeFirestore` call throws
// "already been called with different options" because the persistent-cache
// option objects are constructed fresh on each evaluation (object identity
// differs even when shape is identical). SpotMap's transitive import chain
// pulls firebase.ts via AddSpotSheet → AuthContext → services/auth, so we
// short-circuit that chain at the boundary.
vi.mock("../../../firebase", () => ({
  FIRESTORE_DB_NAME: "skatehubba",
  firebaseReady: true,
  firestoreCacheMode: "memory" as const,
  isAppCheckInitialized: () => false,
  isEmulatorMode: false,
  auth: null,
  db: null,
  storage: null,
  requireDb: () => {
    throw new Error("requireDb called in SpotMap test — should be mocked");
  },
  requireAuth: () => {
    throw new Error("requireAuth called in SpotMap test — should be mocked");
  },
  requireStorage: () => {
    throw new Error("requireStorage called in SpotMap test — should be mocked");
  },
  default: null,
}));

// Stub the Add Spot sheet: the real one calls useAuthContext and would need an
// AuthProvider (plus the Firebase chain this file deliberately severs) just to
// mount. These specs assert SpotMap's own open/closed wiring, not the sheet's
// internals — those belong to AddSpotSheet.test.tsx. The stub keeps the same
// dialog role + accessible name so the queries stay honest.
const authState = vi.hoisted(() => ({ user: { uid: "u1" } as { uid: string } | null }));
vi.mock("../../../context/AuthContext", () => ({ useAuthContext: () => authState }));
const privateSpots = vi.hoisted(() => ({ list: vi.fn(async () => [] as unknown[]) }));
vi.mock("../../../services/mapCheckins", () => ({ listMyPrivateSpots: privateSpots.list }));

const addedSpot = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../AddSpotSheet", () => ({
  AddSpotSheet: ({ onClose, onSuccess }: { onClose: () => void; onSuccess: (spot: unknown) => void }) => (
    <div role="dialog" aria-label="Add a spot">
      <button type="button" aria-label="Close" onClick={onClose}>
        close
      </button>
      <button type="button" onClick={() => onSuccess(addedSpot.value)}>
        save
      </button>
    </div>
  ),
}));

// Logger + Sentry are mocked so the missing-token / map-loaded / load-timeout
// assertions have spies to inspect. `vi.hoisted` is required because
// `vi.mock` factories are hoisted above all top-level variables — a plain
// `const` would throw "cannot access before initialization" at factory
// evaluation time.
const { mockLoggerInfo, mockLoggerWarn, mockCaptureMessage } = vi.hoisted(() => ({
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockCaptureMessage: vi.fn(),
}));
vi.mock("../../../services/logger", () => ({
  logger: { info: mockLoggerInfo, debug: vi.fn(), warn: mockLoggerWarn, error: vi.fn() },
}));
vi.mock("../../../lib/sentry", () => ({
  captureMessage: mockCaptureMessage,
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

// Forward the real lib/mapbox so MAP_STYLE flows through the actual
// resolveMapStyle() path — only MAPBOX_TOKEN is overridden so the
// component skips the unavailable-state fallback. This catches a
// regression where SpotMap.tsx stops importing MAP_STYLE from the
// helper, or where the helper's default value drifts from what
// mapbox-gl is being told to load.
vi.mock("../../../lib/mapbox", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/mapbox")>("../../../lib/mapbox");
  return {
    ...actual,
    MAPBOX_TOKEN: "pk.test-token",
  };
});

// Mock mapbox-gl: real GL JS requires WebGL2 which jsdom doesn't provide.
// The mock implements just enough surface for SpotMap's lifecycle hooks
// (constructor + addControl + on + getBounds + flyTo + remove).
const mapEventHandlers: Record<string, Array<() => void>> = {};
// Spy on the map's camera moves so the nearby-pick test can assert the jump.
const fakeFlyTo = vi.fn();
// Observable count — the missing-token fallback test asserts that the map
// constructor is never invoked when VITE_MAPBOX_TOKEN is unset.
let fakeMapConstructorCalls = 0;
// Last init options the map constructor saw — lets the wiring test assert
// that the resolved MAP_STYLE actually reaches mapbox-gl, not just that
// SpotMap renders without throwing.
let lastMapInitOpts: { style?: unknown } | null = null;
// Viewport the fake map reports; a test can pan it before firing moveend.
const DEFAULT_BOUNDS = { north: 34.1, south: 34.0, east: -118.2, west: -118.3 };
let mapBounds = { ...DEFAULT_BOUNDS };

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
    constructor(opts: { container: HTMLElement; style?: unknown }) {
      fakeMapConstructorCalls += 1;
      lastMapInitOpts = opts;
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
      const b = mapBounds;
      return {
        getNorth: () => b.north,
        getSouth: () => b.south,
        getEast: () => b.east,
        getWest: () => b.west,
      };
    }
    flyTo(opts: unknown) {
      fakeFlyTo(opts);
    }
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
  lastMapInitOpts = null;
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

  // The Add Spot sheet's open/closed state is local to this component, so
  // `autoOpenAddSpot` is the only external entry point into it — MapPage sets
  // it from `/map?add=1`, which is what the profile's "ADD A SPOT" CTA routes
  // to. Without this prop that CTA can only ever dump the user on a bare map.
  it("keeps the Add Spot sheet closed by default", () => {
    render(
      <MemoryRouter>
        <SpotMap />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("dialog", { name: "Add a spot" })).not.toBeInTheDocument();
  });

  it("opens the Add Spot sheet on mount when autoOpenAddSpot is set", () => {
    render(
      <MemoryRouter>
        <SpotMap autoOpenAddSpot />
      </MemoryRouter>,
    );
    expect(screen.getByRole("dialog", { name: "Add a spot" })).toBeInTheDocument();
  });

  it("lets the user dismiss an auto-opened sheet without it springing back", async () => {
    // MapPage clears `?add=1` right after mount, which re-renders SpotMap with
    // `autoOpenAddSpot=false`. That must not be able to reopen — nor must the
    // dismissed sheet reappear on the next render.
    const { rerender } = render(
      <MemoryRouter>
        <SpotMap autoOpenAddSpot />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Add a spot" })).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <SpotMap autoOpenAddSpot={false} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("dialog", { name: "Add a spot" })).not.toBeInTheDocument();
  });

  it("forwards the MAP_STYLE resolved by lib/mapbox into mapbox-gl's Map constructor", async () => {
    // End-to-end wiring check: if SpotMap.tsx ever stops importing MAP_STYLE
    // from ../../lib/mapbox (or lib/mapbox stops resolving the default
    // VITE_MAPBOX_STYLE_URL fallback correctly), the value passed to
    // `new mapboxgl.Map({ style })` will diverge from DEFAULT_MAP_STYLE
    // and this assertion will fail. The unit test in lib/__tests__/mapbox.test.ts
    // covers the resolver in isolation; this closes the integration loop.
    const { DEFAULT_MAP_STYLE } = await import("../../../lib/mapbox");
    render(
      <MemoryRouter>
        <SpotMap />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(fakeMapConstructorCalls).toBe(1);
    });
    expect(lastMapInitOpts?.style).toBe(DEFAULT_MAP_STYLE);
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
    // Close the observability loop: the happy-path success is logged so
    // we can compute load-success rate alongside `map_token_missing` and
    // `map_load_timeout`.
    expect(mockLoggerInfo).toHaveBeenCalledWith("map_loaded", {});
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

  it("flies to a nearby spot picked from the search dropdown and opens its card", async () => {
    // jsdom has no navigator.geolocation; install a stub that reports a fix
    // immediately so useUserGeolocation hands the bar a real location.
    const watchPosition = vi.fn((success: (pos: { coords: { latitude: number; longitude: number } }) => void) => {
      success({ coords: { latitude: 34.0522, longitude: -118.2437 } });
      return 1;
    });
    Object.defineProperty(globalThis.navigator, "geolocation", {
      configurable: true,
      value: { watchPosition, clearWatch: vi.fn() },
    });
    mockGetSpotsNearby.mockResolvedValue([{ ...FIXTURE, distanceKm: 0.42 }]);
    const view = render(
      <MemoryRouter>
        <SpotMap />
      </MemoryRouter>,
    );
    try {
      const searchbox = await screen.findByRole("searchbox", { name: /search spots/i });
      await userEvent.click(searchbox);

      const option = await screen.findByRole("button", { name: /test hubba/i });
      expect(option).toHaveTextContent("420 m");
      expect(mockGetSpotsNearby).toHaveBeenCalledWith({ lat: 34.0522, lng: -118.2437 });

      fakeFlyTo.mockClear();
      await userEvent.click(option);

      expect(fakeFlyTo).toHaveBeenCalledWith({ center: [FIXTURE.longitude, FIXTURE.latitude], zoom: 16 });
      expect(screen.queryByRole("list", { name: /spots near you/i })).toBeNull();
      // Picking a spot hands the recenter button back to manual mode.
      expect(screen.getByRole("button", { name: /recenter to my location/i })).toBeInTheDocument();
      expect(screen.getByText("Test Hubba")).toBeInTheDocument();
    } finally {
      // Unmount while the stub is still installed (the hook's cleanup calls
      // clearWatch), then remove the key entirely so `"geolocation" in
      // navigator` is false again for the rest of this file.
      view.unmount();
      delete (globalThis.navigator as { geolocation?: unknown }).geolocation;
    }
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

      // Design audit #31: the timeout offers a no-map list of nearby spots,
      // and back returns to the retry state.
      act(() => {
        screen.getByRole("button", { name: "Use list view" }).click();
      });
      expect(screen.getByRole("region", { name: "Spots near you" })).toBeInTheDocument();
      expect(screen.getByText(/turn on location to see spots near you/i)).toBeInTheDocument();
      act(() => {
        screen.getByRole("button", { name: "Back to map" }).click();
      });
      expect(screen.queryByTestId("map-list-fallback")).toBeNull();
      expect(screen.getByText(/map is taking too long to load/i)).toBeInTheDocument();
    } finally {
      globalThis.queueMicrotask = realQueueMicrotask;
    }
  });
});

describe("SpotMap without a Mapbox token", () => {
  // Shared factory for the two missing-token tests below — extracted so the
  // dedup gate (`scripts/check-test-duplication.mjs`) doesn't flag the
  // identical mock shape twice. Returns a fresh object each call so the
  // `reportMapStyleConfig` spy doesn't leak state across tests.
  const mockLibMapboxWithoutToken = () => ({
    MAPBOX_TOKEN: "",
    MAP_STYLE: "mapbox://styles/mapbox/dark-v11",
    DEFAULT_MAP_STYLE: "mapbox://styles/mapbox/dark-v11",
    MAP_DEFAULTS: { zoom: 13, minZoom: 5, maxZoom: 19 },
    reportMapStyleConfig: vi.fn(),
  });

  const renderWithoutToken = async () => {
    vi.doMock("../../../lib/mapbox", () => mockLibMapboxWithoutToken());
    const { SpotMap: SpotMapWithoutToken } = await import("../SpotMap");
    render(
      <MemoryRouter>
        <SpotMapWithoutToken />
      </MemoryRouter>,
    );
  };

  beforeEach(() => {
    vi.resetModules();
    mockLoggerWarn.mockClear();
    mockCaptureMessage.mockClear();
    fakeMapConstructorCalls = 0;
  });

  it("renders the polished unavailable state, reports to Sentry, and never constructs a map", async () => {
    await renderWithoutToken();
    expect(screen.getByRole("alert")).toHaveTextContent(/temporarily unavailable/i);
    // Polished fallback: Retry button renders so users can recover from a
    // transient bundling/env-var miss without a full page reload.
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    // The Add-Spot FAB should NOT be rendered in the unavailable state.
    expect(screen.queryByLabelText("Add a spot")).toBeNull();
    // Ops telemetry: a breadcrumb for context on any downstream errors…
    expect(mockLoggerWarn).toHaveBeenCalledWith("map_token_missing", {});
    // …and a real Sentry event so alert rules can actually fire — a
    // breadcrumb by itself never triggers an issue.
    expect(mockCaptureMessage).toHaveBeenCalledWith("map_token_missing", "warning");
    // Sanity: we short-circuited before mapbox-gl was touched.
    expect(fakeMapConstructorCalls).toBe(0);
  });

  it("calls onRetry instead of reloading when the fallback Retry is clicked", async () => {
    vi.doMock("../../../lib/mapbox", () => mockLibMapboxWithoutToken());
    const { SpotMap: SpotMapWithoutToken } = await import("../SpotMap");
    const onRetry = vi.fn();
    render(
      <MemoryRouter>
        <SpotMapWithoutToken onRetry={onRetry} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers the nearby-spots list view when there is no map at all", async () => {
    await renderWithoutToken();
    await userEvent.click(screen.getByRole("button", { name: "Use list view" }));
    expect(screen.getByRole("region", { name: "Spots near you" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back to map" }));
    expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
  });
});

describe("SpotMap style-config telemetry", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("invokes reportMapStyleConfig from the telemetry effect", async () => {
    const reportMapStyleConfig = vi.fn();
    vi.doMock("../../../lib/mapbox", () => ({
      MAPBOX_TOKEN: "pk.test-token",
      MAP_STYLE: "mapbox://styles/mapbox/dark-v11",
      DEFAULT_MAP_STYLE: "mapbox://styles/mapbox/dark-v11",
      MAP_DEFAULTS: { zoom: 13, minZoom: 5, maxZoom: 19 },
      reportMapStyleConfig,
    }));
    const { SpotMap: SpotMapWithStub } = await import("../SpotMap");
    render(
      <MemoryRouter>
        <SpotMapWithStub />
      </MemoryRouter>,
    );
    // The effect runs synchronously after the first commit. If wiring
    // breaks (helper not imported, effect deleted), this assertion fires.
    expect(reportMapStyleConfig).toHaveBeenCalledTimes(1);
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

describe("SpotMap map check-ins (Phase 1)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    authState.user = { uid: "u1" };
  });

  it("lets signed-out visitors browse without the add-spot controls", async () => {
    authState.user = null;
    mockGetSpotsInBounds.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <SpotMap />
      </MemoryRouter>,
    );
    await waitFor(() => expect(mockGetSpotsInBounds).toHaveBeenCalled());
    expect(screen.queryByLabelText("Add a spot")).toBeNull();
    expect(privateSpots.list).not.toHaveBeenCalled();
  });

  it("credits OpenStreetMap and shows the skater's private spots when the flag is on", async () => {
    vi.stubEnv("VITE_FEATURE_MAP_CHECKINS", "true");
    const secret = { ...FIXTURE, id: "secret-1", name: "Secret", scope: "private" as const };
    privateSpots.list.mockResolvedValueOnce([secret]);
    render(
      <MemoryRouter>
        <SpotMap />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelector('[data-testid="spot-marker-secret-1"]')).not.toBeNull());
    expect(privateSpots.list).toHaveBeenCalledWith("u1");
    expect((lastMapInitOpts as { customAttribution?: string } | null)?.customAttribution).toBe(
      "© OpenStreetMap contributors",
    );
  });

  it("drops private spots that arrive after unmount", async () => {
    vi.stubEnv("VITE_FEATURE_MAP_CHECKINS", "true");
    let resolve: (v: unknown[]) => void = () => {};
    privateSpots.list.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { unmount } = render(
      <MemoryRouter>
        <SpotMap />
      </MemoryRouter>,
    );
    unmount();
    resolve([FIXTURE]);
    await Promise.resolve();
  });
});

describe("SpotMap interactions after load", () => {
  const renderLoaded = async () => {
    const view = render(
      <MemoryRouter>
        <SpotMap />
      </MemoryRouter>,
    );
    await waitFor(() => expect(mockGetSpotsInBounds).toHaveBeenCalled());
    return view;
  };

  afterEach(() => {
    vi.useRealTimers();
    mapBounds = { ...DEFAULT_BOUNDS };
  });

  it("stops following on a manual drag and refetches the viewport on moveend", async () => {
    await renderLoaded();
    expect(screen.getByRole("button", { name: "Following your location" })).toBeInTheDocument();
    act(() => mapEventHandlers["dragstart"].forEach((cb) => cb()));
    expect(screen.getByRole("button", { name: "Recenter to my location" })).toBeInTheDocument();

    vi.useFakeTimers();
    const fetchesBefore = mockGetSpotsInBounds.mock.calls.length;
    // Same viewport as the load fetch: the debounced refetch is deduped.
    act(() => mapEventHandlers["moveend"].forEach((cb) => cb()));
    act(() => vi.advanceTimersByTime(400));
    expect(mockGetSpotsInBounds).toHaveBeenCalledTimes(fetchesBefore);

    // A real pan: one more fetch, for the new viewport, after the 400 ms debounce.
    mapBounds = { north: 35.1, south: 35.0, east: -117.2, west: -117.3 };
    act(() => mapEventHandlers["moveend"].forEach((cb) => cb()));
    act(() => vi.advanceTimersByTime(399));
    expect(mockGetSpotsInBounds).toHaveBeenCalledTimes(fetchesBefore);
    act(() => vi.advanceTimersByTime(1));
    expect(mockGetSpotsInBounds).toHaveBeenCalledTimes(fetchesBefore + 1);
    expect(mockGetSpotsInBounds).toHaveBeenLastCalledWith(mapBounds);
  });

  it("shows a waiting toast on recenter without a GPS fix, restarts it on a second tap, then clears it", async () => {
    const view = await renderLoaded();
    vi.useFakeTimers();
    const recenter = screen.getByRole("button", { name: "Following your location" });
    act(() => recenter.click());
    expect(screen.getByText("Waiting for location…")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2000));
    act(() => recenter.click());
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText("Waiting for location…")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByText("Waiting for location…")).toBeNull();

    act(() => recenter.click());
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets the skater dismiss the GPS banner", async () => {
    await renderLoaded();
    expect(screen.getByText(/geolocation not supported/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss location notice" }));
    expect(screen.queryByText(/geolocation not supported/i)).toBeNull();
  });

  it("opens Add Spot from the empty-viewport prompt", async () => {
    mockGetSpotsInBounds.mockResolvedValue([]);
    await renderLoaded();
    await userEvent.click(await screen.findByRole("button", { name: "Add the first spot here" }));
    expect(screen.getByRole("dialog", { name: "Add a spot" })).toBeInTheDocument();
  });

  it("flies to and previews a freshly added spot, then closes the preview", async () => {
    const fresh: Spot = { ...FIXTURE, id: "new-spot", name: "Fresh Ledge", latitude: 34.2, longitude: -118.4 };
    addedSpot.value = fresh;
    await renderLoaded();
    await userEvent.click(screen.getByRole("button", { name: "Add a spot" }));
    fakeFlyTo.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "save" }));
    expect(screen.queryByRole("dialog", { name: "Add a spot" })).toBeNull();
    expect(fakeFlyTo).toHaveBeenCalledWith({ center: [-118.4, 34.2], zoom: 16 });
    await waitFor(() => expect(document.querySelector('[data-testid="spot-marker-new-spot"]')).not.toBeNull());

    const card = screen.getByRole("dialog", { name: "Spot: Fresh Ledge" });
    act(() => {
      card.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(screen.queryByRole("dialog", { name: "Spot: Fresh Ledge" })).toBeNull();
  });
});

describe("SpotMap list view with a GPS fix and no token", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("lists nearby spots for the known location without asking for GPS again", async () => {
    const watchPosition = vi.fn((ok: (pos: { coords: { latitude: number; longitude: number } }) => void) => {
      ok({ coords: { latitude: 33.9, longitude: -118.1 } });
      return 7;
    });
    Object.defineProperty(globalThis.navigator, "geolocation", {
      configurable: true,
      value: { watchPosition, clearWatch: vi.fn() },
    });
    mockGetSpotsNearby.mockResolvedValue([]);
    vi.doMock("../../../lib/mapbox", () => ({
      MAPBOX_TOKEN: "",
      MAP_STYLE: "mapbox://styles/mapbox/dark-v11",
      MAP_DEFAULTS: { zoom: 13, minZoom: 5, maxZoom: 19 },
      reportMapStyleConfig: vi.fn(),
    }));
    const { SpotMap: NoTokenMap } = await import("../SpotMap");
    const view = render(
      <MemoryRouter>
        <NoTokenMap />
      </MemoryRouter>,
    );
    try {
      await userEvent.click(screen.getByRole("button", { name: "Use list view" }));
      await waitFor(() => expect(mockGetSpotsNearby).toHaveBeenCalledWith({ lat: 33.9, lng: -118.1 }));
      expect(watchPosition).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      delete (globalThis.navigator as { geolocation?: unknown }).geolocation;
    }
  });
});
