import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapboxMap } from "mapbox-gl";
import type { Spot } from "../../../types/spot";

const spotsApi = vi.hoisted(() => ({ inBounds: vi.fn() }));
vi.mock("../../../services/spots", () => ({ getSpotsInBounds: spotsApi.inBounds }));
const warn = vi.hoisted(() => vi.fn());
vi.mock("../../../services/logger", () => ({ logger: { warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

// Markers record their element so the tests can click them and inspect the
// pulse ring; addTo/remove mirror the element in and out of the document.
const placed: HTMLElement[] = [];
vi.mock("mapbox-gl", () => ({
  default: {
    Marker: class {
      readonly element: HTMLElement;
      constructor({ element }: { element: HTMLElement }) {
        this.element = element;
      }
      setLngLat() {
        return this;
      }
      addTo() {
        placed.push(this.element);
        document.body.appendChild(this.element);
        return this;
      }
      remove() {
        this.element.remove();
      }
    },
  },
}));

import { useSpotsInBounds } from "../useSpotsInBounds";
import { useSpotMarkers } from "../useSpotMarkers";

type Box = { n: number; s: number; e: number; w: number };

function fakeMap(box: Box | null) {
  const state = { box };
  const map = {
    getBounds: () =>
      state.box && {
        getNorth: () => state.box!.n,
        getSouth: () => state.box!.s,
        getEast: () => state.box!.e,
        getWest: () => state.box!.w,
      },
  } as unknown as MapboxMap;
  return { map, state };
}

function spot(id: string, extra: Partial<Spot> = {}): Spot {
  return {
    id,
    createdBy: "u",
    name: id,
    description: null,
    latitude: 1,
    longitude: 2,
    gnarRating: 1,
    bustRisk: 1,
    obstacles: [],
    photoUrls: [],
    isVerified: false,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

describe("useSpotsInBounds", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spotsApi.inBounds.mockReset();
    warn.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("debounces bursts, skips a missing viewport, and only refetches on a real pan", async () => {
    spotsApi.inBounds.mockResolvedValue([spot("a")]);
    const { result } = renderHook(() => useSpotsInBounds());
    const empty = fakeMap(null);
    act(() => result.current.fetchSpots(empty.map));
    await act(async () => vi.advanceTimersByTime(400));
    expect(spotsApi.inBounds).not.toHaveBeenCalled();

    const { map, state } = fakeMap({ n: 10, s: 0, e: 10, w: 0 });
    act(() => {
      result.current.fetchSpots(map);
      result.current.fetchSpots(map);
    });
    await act(async () => vi.advanceTimersByTime(400));
    expect(spotsApi.inBounds).toHaveBeenCalledTimes(1);
    expect(result.current.spots.map((s) => s.id)).toEqual(["a"]);

    // Each edge moving on its own counts as a pan; a sub-threshold nudge does not.
    const pans: Box[] = [
      { n: 11, s: 0, e: 10, w: 0 },
      { n: 11, s: 1, e: 10, w: 0 },
      { n: 11, s: 1, e: 11, w: 0 },
      { n: 11, s: 1, e: 11, w: 1 },
      { n: 11.0001, s: 1, e: 11, w: 1 },
    ];
    for (const box of pans) {
      state.box = box;
      act(() => result.current.fetchSpots(map));
      await act(async () => vi.advanceTimersByTime(400));
    }
    expect(spotsApi.inBounds).toHaveBeenCalledTimes(5);
    expect(spotsApi.inBounds).toHaveBeenLastCalledWith({ north: 11, south: 1, east: 11, west: 1 });
  });

  it("drops results and errors from a fetch that a newer pan superseded", async () => {
    const resolvers: Array<{ ok: (v: Spot[]) => void; fail: (e: unknown) => void }> = [];
    spotsApi.inBounds.mockImplementation(() => new Promise<Spot[]>((ok, fail) => resolvers.push({ ok, fail })));
    const { result } = renderHook(() => useSpotsInBounds());
    const { map, state } = fakeMap({ n: 1, s: 0, e: 1, w: 0 });
    for (const n of [1, 2, 3]) {
      state.box = { n, s: 0, e: 1, w: 0 };
      act(() => result.current.fetchSpots(map));
      await act(async () => vi.advanceTimersByTime(400));
    }
    await act(async () => {
      resolvers[0].ok([spot("stale")]);
      resolvers[1].fail(new Error("stale failure"));
    });
    expect(result.current.spots).toEqual([]);
    expect(warn).not.toHaveBeenCalled();

    await act(async () => resolvers[2].fail("offline"));
    expect(warn).toHaveBeenCalledWith("fetch_spots_failed", { error: "unknown" });
  });
});

describe("useSpotMarkers", () => {
  beforeEach(() => {
    placed.length = 0;
    document.body.innerHTML = "";
  });

  const marker = (id: string) => document.querySelector<HTMLElement>(`[data-testid="spot-marker-${id}"]`);

  it("colours verified spots, pulses the active game spot, and rebuilds markers when it moves", () => {
    const map = { current: {} as MapboxMap };
    const onSpotClick = vi.fn();
    const spots = [spot("a", { isVerified: true }), spot("b")];
    const { rerender } = renderHook(
      (p: { active?: string }) => useSpotMarkers({ map, visibleSpots: spots, activeGameSpotId: p.active, onSpotClick }),
      { initialProps: { active: "a" } },
    );
    expect(marker("a")!.style.backgroundColor).toBe("rgb(34, 197, 94)");
    expect(marker("b")!.style.backgroundColor).toBe("rgb(255, 107, 0)");
    expect(marker("a")!.querySelector(".spot-pulse-ring")).not.toBeNull();
    expect(placed).toHaveLength(2);

    rerender({ active: "b" });
    expect(placed).toHaveLength(4);
    expect(marker("a")!.querySelector(".spot-pulse-ring")).toBeNull();
    expect(marker("b")!.querySelector(".spot-pulse-ring")).not.toBeNull();

    // Same props again: existing markers are kept as they are.
    rerender({ active: "b" });
    expect(placed).toHaveLength(4);

    const parentClick = vi.fn();
    document.body.addEventListener("click", parentClick);
    marker("b")!.click();
    document.body.removeEventListener("click", parentClick);
    expect(onSpotClick).toHaveBeenCalledWith(spots[1]);
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("drops the old active marker cleanly when it is filtered out at the same time", () => {
    const map = { current: {} as MapboxMap };
    const { rerender, unmount } = renderHook(
      (p: { spots: Spot[]; active?: string }) =>
        useSpotMarkers({ map, visibleSpots: p.spots, activeGameSpotId: p.active, onSpotClick: vi.fn() }),
      { initialProps: { spots: [spot("a"), spot("b")], active: "a" as string | undefined } },
    );
    rerender({ spots: [spot("b")], active: undefined });
    expect(marker("a")).toBeNull();
    expect(marker("b")).not.toBeNull();
    unmount();
    expect(marker("b")).toBeNull();
  });
});
