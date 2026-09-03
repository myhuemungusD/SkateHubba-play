import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NearbySpot } from "../../../services/spots";

const { mockGetSpotsNearby, mockLoggerWarn } = vi.hoisted(() => ({
  mockGetSpotsNearby: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));
vi.mock("../../../services/spots", () => ({
  getSpotsNearby: mockGetSpotsNearby,
}));
vi.mock("../../../services/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: mockLoggerWarn, error: vi.fn() },
}));

import { useNearbySpots } from "../useNearbySpots";

const LA = { lat: 34.0522, lng: -118.2437 };

function makeNearby(id: string, distanceKm: number): NearbySpot {
  return {
    id,
    createdBy: "u",
    name: `Spot ${id}`,
    description: null,
    latitude: LA.lat,
    longitude: LA.lng,
    gnarRating: 3,
    bustRisk: 2,
    obstacles: ["ledge"],
    photoUrls: [],
    isVerified: false,
    isActive: true,
    createdAt: "2026-04-10T00:00:00.000Z",
    updatedAt: "2026-04-10T00:00:00.000Z",
    distanceKm,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useNearbySpots", () => {
  it("stays idle and never fetches while disabled", () => {
    const { result } = renderHook(() => useNearbySpots(LA, false));
    expect(result.current.status).toBe("idle");
    expect(mockGetSpotsNearby).not.toHaveBeenCalled();
  });

  it("reports no-gps when enabled without a location", () => {
    const { result } = renderHook(() => useNearbySpots(null, true));
    expect(result.current.status).toBe("no-gps");
    expect(mockGetSpotsNearby).not.toHaveBeenCalled();
  });

  it("fetches when enabled with a location and exposes the sorted list", async () => {
    const list = [makeNearby("a", 0.2), makeNearby("b", 1.4)];
    mockGetSpotsNearby.mockResolvedValueOnce(list);

    const { result } = renderHook(() => useNearbySpots(LA, true));
    expect(result.current.status).toBe("loading");

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.spots).toEqual(list);
    expect(mockGetSpotsNearby).toHaveBeenCalledWith(LA);
  });

  it("reuses the cached list for a GPS fix within 250 m, refetches beyond it", async () => {
    mockGetSpotsNearby.mockResolvedValue([makeNearby("a", 0.2)]);
    const { result, rerender } = renderHook(({ loc }) => useNearbySpots(loc, true), {
      initialProps: { loc: LA },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mockGetSpotsNearby).toHaveBeenCalledTimes(1);

    // ~11 m north — jitter, no refetch.
    rerender({ loc: { lat: LA.lat + 0.0001, lng: LA.lng } });
    expect(result.current.status).toBe("ready");
    expect(mockGetSpotsNearby).toHaveBeenCalledTimes(1);

    // ~1.1 km north — real movement, refetch.
    rerender({ loc: { lat: LA.lat + 0.01, lng: LA.lng } });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mockGetSpotsNearby).toHaveBeenCalledTimes(2);
  });

  it("drops a stale result when a newer fetch has started", async () => {
    let resolveFirst: (v: NearbySpot[]) => void = () => {};
    mockGetSpotsNearby
      .mockImplementationOnce(
        () =>
          new Promise<NearbySpot[]>((res) => {
            resolveFirst = res;
          }),
      )
      .mockResolvedValueOnce([makeNearby("second", 0.1)]);

    const { result, rerender } = renderHook(({ loc }) => useNearbySpots(loc, true), {
      initialProps: { loc: LA },
    });
    rerender({ loc: { lat: LA.lat + 0.01, lng: LA.lng } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.spots.map((s) => s.id)).toEqual(["second"]);

    await act(async () => {
      resolveFirst([makeNearby("first", 0.1)]);
    });
    expect(result.current.spots.map((s) => s.id)).toEqual(["second"]);
  });

  it("surfaces an error state and logs when the fetch rejects", async () => {
    mockGetSpotsNearby.mockRejectedValueOnce(new Error("permission-denied"));
    const { result } = renderHook(() => useNearbySpots(LA, true));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(mockLoggerWarn).toHaveBeenCalledWith("fetch_nearby_spots_failed", { error: "permission-denied" });
  });

  it("logs 'unknown' for a non-Error rejection and ignores a stale rejection", async () => {
    let rejectFirst: (e: unknown) => void = () => {};
    mockGetSpotsNearby
      .mockImplementationOnce(
        () =>
          new Promise<NearbySpot[]>((_res, rej) => {
            rejectFirst = rej;
          }),
      )
      .mockRejectedValueOnce("boom");

    const { result, rerender } = renderHook(({ loc }) => useNearbySpots(loc, true), {
      initialProps: { loc: LA },
    });
    rerender({ loc: { lat: LA.lat + 0.01, lng: LA.lng } });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    expect(mockLoggerWarn).toHaveBeenCalledWith("fetch_nearby_spots_failed", { error: "unknown" });

    await act(async () => {
      rejectFirst(new Error("stale"));
    });
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
  });

  it("returns to idle when disabled again", async () => {
    mockGetSpotsNearby.mockResolvedValueOnce([]);
    const { result, rerender } = renderHook(({ on }) => useNearbySpots(LA, on), {
      initialProps: { on: true },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ on: false });
    expect(result.current.status).toBe("idle");
  });

  it("reopening the dropdown in place reuses the cached list without a second read", async () => {
    mockGetSpotsNearby.mockResolvedValueOnce([makeNearby("a", 0.2)]);
    const { result, rerender } = renderHook(({ on }) => useNearbySpots(LA, on), {
      initialProps: { on: true },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ on: false });
    rerender({ on: true });
    expect(result.current.status).toBe("ready");
    expect(result.current.spots.map((s) => s.id)).toEqual(["a"]);
    expect(mockGetSpotsNearby).toHaveBeenCalledTimes(1);
  });

  it("retries after a failure on the next GPS tick, and stops after three consecutive failures", async () => {
    mockGetSpotsNearby.mockRejectedValue(new Error("offline"));
    const { result, rerender } = renderHook(({ loc }) => useNearbySpots(loc, true), {
      initialProps: { loc: LA },
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(mockGetSpotsNearby).toHaveBeenCalledTimes(1);

    // Tick 2 (new object, same place) → retry.
    rerender({ loc: { ...LA } });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(mockGetSpotsNearby).toHaveBeenCalledTimes(2);

    // Tick 3 → last allowed retry.
    rerender({ loc: { ...LA } });
    await waitFor(() => expect(mockGetSpotsNearby).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.status).toBe("error"));

    // Ticks 4 and 5 → capped, no more reads while this open lasts.
    rerender({ loc: { ...LA } });
    rerender({ loc: { ...LA } });
    expect(result.current.status).toBe("error");
    expect(mockGetSpotsNearby).toHaveBeenCalledTimes(3);
  });

  it("clears a failed result on close so a stationary device can retry on reopen", async () => {
    mockGetSpotsNearby.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([makeNearby("a", 0.2)]);
    const { result, rerender } = renderHook(({ on }) => useNearbySpots(LA, on), {
      initialProps: { on: true },
    });
    await waitFor(() => expect(result.current.status).toBe("error"));

    rerender({ on: false });
    expect(result.current.status).toBe("idle");

    // Same GPS object, no new tick — reopen alone must trigger the retry.
    rerender({ on: true });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mockGetSpotsNearby).toHaveBeenCalledTimes(2);
  });

  it("a success after failures resets the failure count", async () => {
    mockGetSpotsNearby
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([makeNearby("a", 0.2)])
      .mockRejectedValue(new Error("offline"));
    const { result, rerender } = renderHook(({ loc }) => useNearbySpots(loc, true), {
      initialProps: { loc: LA },
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    rerender({ loc: { ...LA } });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // Move > 250 m so the cached success goes stale; three fresh failures
    // are allowed again before the cap bites.
    const far = { lat: LA.lat + 0.01, lng: LA.lng };
    rerender({ loc: far });
    await waitFor(() => expect(result.current.status).toBe("error"));
    rerender({ loc: { ...far } });
    await waitFor(() => expect(mockGetSpotsNearby).toHaveBeenCalledTimes(4));
    rerender({ loc: { ...far } });
    await waitFor(() => expect(mockGetSpotsNearby).toHaveBeenCalledTimes(5));
    rerender({ loc: { ...far } });
    expect(mockGetSpotsNearby).toHaveBeenCalledTimes(5);
  });
});
