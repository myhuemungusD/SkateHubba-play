import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the mapbox lib config: leave MAP_STYLE/MAP_DEFAULTS real but allow
// per-test overrides of MAPBOX_TOKEN so the missing-token fallback branch is
// reachable without rebuilding Vite.
const { setMapboxToken } = vi.hoisted(() => {
  const state = { token: "pk.test-token" as string | undefined };
  return {
    setMapboxToken: (next: string | undefined) => {
      state.token = next;
    },
    __state: state,
    getMapboxToken: () => state.token,
  };
});

vi.mock("../../../lib/mapbox", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/mapbox")>("../../../lib/mapbox");
  return {
    ...actual,
    get MAPBOX_TOKEN(): string | undefined {
      // Re-reads the hoisted state on every access so per-test overrides win.
      // The key is always present after setToken() runs, so we can return its
      // value directly (including undefined) instead of `??` which would mask
      // the "missing token" branch under test.
      const g = globalThis as { __landingMapToken?: string };
      return "__landingMapToken" in g ? g.__landingMapToken : "pk.test-token";
    },
    reportMapStyleConfig: vi.fn(),
  };
});

// Mock mapbox-gl: jsdom can't run real WebGL. The fake records constructor
// invocations + replays the `load` event so marker creation runs.
const mapLoadHandlers: Array<() => void> = [];
let fakeMapCtorCalls = 0;
const markerInstances: Array<{ el: HTMLElement }> = [];

vi.mock("mapbox-gl", () => {
  class FakeMarker {
    el: HTMLElement;
    constructor(opts: { element: HTMLElement }) {
      this.el = opts.element;
      markerInstances.push(this);
    }
    setLngLat() {
      return this;
    }
    addTo() {
      document.body.appendChild(this.el);
      return this;
    }
    remove() {
      this.el.remove();
    }
  }
  class FakeMap {
    doubleClickZoom = { disable: vi.fn() };
    boxZoom = { disable: vi.fn() };
    constructor() {
      fakeMapCtorCalls += 1;
    }
    on(event: string, cb: () => void) {
      if (event === "load") mapLoadHandlers.push(cb);
    }
    remove() {
      /* no-op */
    }
  }
  return {
    default: { Map: FakeMap, Marker: FakeMarker, accessToken: "" },
    Map: FakeMap,
    Marker: FakeMarker,
  };
});

// Skip the CSS import — jsdom can't parse it and we don't need styles for unit tests.
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

// Spy on analytics so we can assert the marketing funnel events fire without
// pulling in PostHog or Vercel Analytics during the unit run.
const landingMapViewed = vi.fn();
const landingPinClicked = vi.fn();
vi.mock("../../../services/analytics", () => ({
  analytics: {
    landingMapViewed: (...args: unknown[]) => landingMapViewed(...args),
    landingPinClicked: (...args: unknown[]) => landingPinClicked(...args),
  },
}));

import { LandingMap } from "../LandingMap";
import { LANDING_SPOTS } from "../landingSpots";

function setToken(token: string | undefined) {
  (globalThis as { __landingMapToken?: string }).__landingMapToken = token;
  setMapboxToken(token);
}

// Shared setup for tests that need to open the locked-pin CTA modal:
// mount the map, fire the deferred "load" handler so markers are created,
// click the first locked pin, and wait for the modal dialog to appear.
async function mountAndOpenCta(onSignUpPrompt: Mock<() => void> = vi.fn()) {
  const utils = render(<LandingMap onSignUpPrompt={onSignUpPrompt} />);
  await waitFor(() => expect(mapLoadHandlers.length).toBe(1));
  await act(async () => {
    mapLoadHandlers[0]();
  });
  await waitFor(() => expect(markerInstances.length).toBeGreaterThan(0));
  await act(async () => {
    markerInstances[0].el.click();
  });
  const dialog = await screen.findByRole("dialog");
  return { onSignUpPrompt, dialog, ...utils };
}

describe("LandingMap", () => {
  beforeEach(() => {
    fakeMapCtorCalls = 0;
    mapLoadHandlers.length = 0;
    markerInstances.length = 0;
    landingMapViewed.mockClear();
    landingPinClicked.mockClear();
    setToken("pk.test-token");
  });

  it("renders the fallback card when MAPBOX_TOKEN is undefined", () => {
    setToken(undefined);
    const onSignUpPrompt = vi.fn();
    render(<LandingMap onSignUpPrompt={onSignUpPrompt} />);
    expect(screen.getByText("Spots near you")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign up to explore" })).toBeInTheDocument();
    // Construction must NOT happen in the fallback path — that's the whole
    // point of the token guard.
    expect(fakeMapCtorCalls).toBe(0);
  });

  it("fires onSignUpPrompt from the fallback CTA", async () => {
    setToken(undefined);
    const onSignUpPrompt = vi.fn();
    render(<LandingMap onSignUpPrompt={onSignUpPrompt} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign up to explore" }));
    expect(onSignUpPrompt).toHaveBeenCalledTimes(1);
  });

  it("renders the map container when the token is present", async () => {
    render(<LandingMap onSignUpPrompt={vi.fn()} />);
    expect(screen.getByTestId("landing-map-container")).toBeInTheDocument();
    await waitFor(() => expect(fakeMapCtorCalls).toBe(1));
  });

  it("opens the CTA modal when a locked pin is clicked and calls onSignUpPrompt", async () => {
    const { onSignUpPrompt, dialog } = await mountAndOpenCta();

    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Sign up to see real spots near you")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Sign up free" }));
    expect(onSignUpPrompt).toHaveBeenCalledTimes(1);
  });

  it("closes the CTA modal via the Keep looking button without firing onSignUpPrompt", async () => {
    const { onSignUpPrompt, dialog } = await mountAndOpenCta();
    expect(dialog).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Keep looking" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onSignUpPrompt).not.toHaveBeenCalled();
  });

  it("fires landingMapViewed once on mount (token present)", () => {
    render(<LandingMap onSignUpPrompt={vi.fn()} />);
    expect(landingMapViewed).toHaveBeenCalledTimes(1);
  });

  it("fires landingMapViewed once on mount (fallback path)", () => {
    setToken(undefined);
    render(<LandingMap onSignUpPrompt={vi.fn()} />);
    expect(landingMapViewed).toHaveBeenCalledTimes(1);
  });

  it("emits landing_pin_clicked with the spot id when a pin is clicked", async () => {
    await mountAndOpenCta();
    expect(landingPinClicked).toHaveBeenCalledTimes(1);
    expect(landingPinClicked).toHaveBeenCalledWith(LANDING_SPOTS[0].id);
  });
});
