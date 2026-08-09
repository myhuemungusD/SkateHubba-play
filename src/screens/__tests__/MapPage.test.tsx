import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";

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
//
// Both `data-mount-id` and `data-auto-open-add-spot` are latched in `useState`
// initialisers rather than read per-render. That mirrors the real component,
// which seeds `isAddingSpot` from `autoOpenAddSpot` exactly once at mount and
// ignores later prop changes — MapPage clears `?add=1` immediately, so a
// per-render read would report `false` even though the sheet did open.
let spotMapMountCounter = 0;
let spotMapShouldThrow = false;
vi.mock("../../components/map/SpotMap", async () => {
  const { useState } = await import("react");
  return {
    SpotMap: (props: {
      activeGameSpotId?: string;
      onSpotSelect?: (s: { id: string }) => void;
      onRetry?: () => void;
      autoOpenAddSpot?: boolean;
    }) => {
      if (spotMapShouldThrow) {
        throw new Error("Simulated mapbox crash");
      }
      const [mountId] = useState(() => ++spotMapMountCounter);
      const [openedAddSpotAtMount] = useState(props.autoOpenAddSpot ?? false);
      return (
        <div
          data-testid="spot-map-stub"
          data-active-spot={props.activeGameSpotId ?? ""}
          data-mount-id={String(mountId)}
          data-auto-open-add-spot={String(openedAddSpotAtMount)}
          onClick={() => props.onSpotSelect?.({ id: "preview-spot-id" })}
        >
          <button type="button" data-testid="trigger-retry" onClick={() => props.onRetry?.()}>
            trigger retry
          </button>
        </div>
      );
    },
  };
});

import { MapPage } from "../MapPage";

/** Surfaces the live URL so the param-consumption specs can assert on it. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

/**
 * MapPage reads `?add=1` off the URL, so every render needs a router. Single
 * helper keeps the router boilerplate in one place (and the duplication gate
 * green) while letting each spec pick its own entry URL.
 */
function renderMapPage(initialEntry = "/map") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <MapPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/**
 * Run `body` with `window.location.reload` replaced by a spy, restoring the
 * real location afterwards even if the assertions throw. The boundary's
 * escalation specs both need this, and a leaked stub would poison every later
 * test in the file.
 */
function withStubbedReload(body: (reloadSpy: ReturnType<typeof vi.fn>) => void): void {
  const reloadSpy = vi.fn();
  const originalLocation = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...originalLocation, reload: reloadSpy },
  });
  try {
    body(reloadSpy);
  } finally {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  spotMapMountCounter = 0;
  spotMapShouldThrow = false;
  mockUseGameContext.mockReturnValue({ activeGame: null });
});

describe("MapPage", () => {
  it("fires the mapViewed funnel event once on mount", () => {
    renderMapPage();
    expect(mockMapViewed).toHaveBeenCalledTimes(1);
  });

  it("does not pass an activeGameSpotId when there is no active game", () => {
    renderMapPage();
    expect(screen.getByTestId("spot-map-stub").getAttribute("data-active-spot")).toBe("");
  });

  it("passes the active game's spotId through to SpotMap", () => {
    mockUseGameContext.mockReturnValue({
      activeGame: { id: "g1", spotId: "11111111-2222-3333-4444-555555555555" },
    });
    renderMapPage();
    expect(screen.getByTestId("spot-map-stub").getAttribute("data-active-spot")).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it("forwards spot selection to analytics.spotPreviewed", () => {
    renderMapPage();
    screen.getByTestId("spot-map-stub").click();
    expect(mockSpotPreviewed).toHaveBeenCalledWith("preview-spot-id");
  });

  it("remounts SpotMap when onRetry fires instead of doing a full page reload", () => {
    renderMapPage();
    const initialMountId = screen.getByTestId("spot-map-stub").getAttribute("data-mount-id");
    expect(initialMountId).toBe("1");

    act(() => {
      screen.getByTestId("trigger-retry").click();
    });

    // A fresh mount id is the observable signal that the `key` bump worked
    // and the component was torn down + rebuilt without `window.location.reload`.
    expect(screen.getByTestId("spot-map-stub").getAttribute("data-mount-id")).toBe("2");
  });

  // ── `?add=1` deep link (profile "ADD A SPOT" CTA) ──────
  //
  // `setScreen("map")` alone lands on a bare map with the Add Spot sheet shut,
  // because that sheet's open state is local to SpotMap. The param is the
  // external entry point; these specs guard both halves of the contract —
  // it opens the sheet, and it is consumed so it can't fire twice.

  describe("add-spot deep link", () => {
    it("asks SpotMap to open the Add Spot sheet when arriving at /map?add=1", () => {
      renderMapPage("/map?add=1");
      expect(screen.getByTestId("spot-map-stub").getAttribute("data-auto-open-add-spot")).toBe("true");
    });

    it("does not open the Add Spot sheet on a plain /map visit", () => {
      renderMapPage();
      expect(screen.getByTestId("spot-map-stub").getAttribute("data-auto-open-add-spot")).toBe("false");
    });

    it("ignores a non-'1' add param rather than opening the sheet", () => {
      renderMapPage("/map?add=0");
      expect(screen.getByTestId("spot-map-stub").getAttribute("data-auto-open-add-spot")).toBe("false");
    });

    it("consumes the add param so a refresh or Back navigation can't reopen the sheet", async () => {
      renderMapPage("/map?add=1");
      await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/map"));
    });

    it("preserves unrelated query params while consuming add", async () => {
      renderMapPage("/map?add=1&foo=bar");
      await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/map?foo=bar"));
    });

    it("does not re-open the sheet when SpotMap remounts after a retry", async () => {
      renderMapPage("/map?add=1");
      await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/map"));

      act(() => {
        screen.getByTestId("trigger-retry").click();
      });

      // The param is already spent, so the fresh mount must come up with the
      // sheet closed — otherwise a map-load retry would resurrect a sheet the
      // user had deliberately dismissed.
      const stub = screen.getByTestId("spot-map-stub");
      expect(stub.getAttribute("data-mount-id")).toBe("2");
      expect(stub.getAttribute("data-auto-open-add-spot")).toBe("false");
    });
  });

  describe("MapErrorBoundary fallback", () => {
    // React logs errors it caught in a boundary to console.error. Silence
    // those for this block so the spec output stays clean; we reassert
    // the boundary caught them by the visible alert + console.warn trace.
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it("renders an alert with Try again as the sole action on first trip (no nuclear Reload yet)", () => {
      spotMapShouldThrow = true;
      renderMapPage();
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
      // Hard reload is withheld on first trip — in-app remount must be
      // attempted before we escalate to the page-level escape hatch.
      expect(screen.queryByRole("button", { name: /reload page/i })).not.toBeInTheDocument();
    });

    it("Try again clears the boundary and remounts SpotMap without a full reload", () => {
      withStubbedReload((reloadSpy) => {
        spotMapShouldThrow = true;
        renderMapPage();
        expect(screen.getByRole("alert")).toBeInTheDocument();

        // Simulate the root cause clearing before the user taps Try again.
        spotMapShouldThrow = false;
        act(() => {
          screen.getByRole("button", { name: /try again/i }).click();
        });

        // Boundary cleared, fresh SpotMap mounted, and the nuclear reload path
        // was never taken.
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.getByTestId("spot-map-stub")).toBeInTheDocument();
        expect(reloadSpy).not.toHaveBeenCalled();
      });
    });

    it("keeps the fallback visible if the underlying error reoccurs on reset", () => {
      spotMapShouldThrow = true;
      renderMapPage();
      expect(screen.getByRole("alert")).toBeInTheDocument();

      // Leave the throw toggle ON — this simulates a persistent crash that
      // the in-app reset can't fix. The user should see the fallback again
      // so they can escalate to Reload page.
      act(() => {
        screen.getByRole("button", { name: /try again/i }).click();
      });
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /reload page/i })).toBeInTheDocument();
    });

    it("Reload page only appears after an in-app retry has failed, then triggers window.location.reload", () => {
      withStubbedReload((reloadSpy) => {
        spotMapShouldThrow = true;
        renderMapPage();
        // First trip — Reload page is intentionally withheld.
        expect(screen.queryByRole("button", { name: /reload page/i })).not.toBeInTheDocument();

        // Attempt in-app recovery; the underlying fault persists so the
        // boundary re-trips and now the last-resort Reload page surfaces.
        act(() => {
          screen.getByRole("button", { name: /try again/i }).click();
        });
        const reloadBtn = screen.getByRole("button", { name: /reload page/i });
        act(() => {
          reloadBtn.click();
        });
        expect(reloadSpy).toHaveBeenCalledTimes(1);
      });
    });
  });
});
