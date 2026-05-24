import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the mapbox lib config: leave MAP_STYLE/MAP_DEFAULTS real but allow
// per-test overrides of MAPBOX_TOKEN so the missing-token fallback branch is
// reachable without rebuilding Vite. The current value lives on `globalThis`
// so the hoisted `vi.mock` getter (which runs before any test code) can read
// it without a circular module-init dance.
vi.mock("../../../lib/mapbox", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/mapbox")>("../../../lib/mapbox");
  return {
    ...actual,
    get MAPBOX_TOKEN(): string | undefined {
      // Re-reads on every access so per-test overrides win. We check for the
      // KEY rather than truthiness so `setToken(undefined)` exercises the
      // missing-token branch instead of silently falling back to the default.
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

import { LandingMap } from "../LandingMap";

function setToken(token: string | undefined) {
  (globalThis as { __landingMapToken?: string }).__landingMapToken = token;
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
});
