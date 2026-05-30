import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapboxMap } from "mapbox-gl";
import { useUserGeolocation } from "../useUserGeolocation";

// The hook only touches mapbox via `new mapboxgl.Marker(...).setLngLat(...).addTo(map)`
// and the resulting `Marker.remove()`. Mock just enough surface to observe
// those calls and confirm cleanup fires on unmount.
const markerRemove = vi.fn();
const markerSetLngLat = vi.fn().mockReturnThis();
const markerAddTo = vi.fn().mockReturnThis();

vi.mock("mapbox-gl", () => {
  class FakeMarker {
    setLngLat = markerSetLngLat;
    addTo = markerAddTo;
    remove = markerRemove;
  }
  return { default: { Marker: FakeMarker } };
});

interface FakeMap {
  flyTo: ReturnType<typeof vi.fn>;
  easeTo: ReturnType<typeof vi.fn>;
}

function makeMapRef(): { current: FakeMap } {
  return { current: { flyTo: vi.fn(), easeTo: vi.fn() } };
}

// jsdom has `navigator.geolocation` as undefined; install a controllable stub
// so the hook's GPS effect runs through its success path and we can drive a
// position update synchronously from the test.
type SuccessCb = (pos: { coords: { latitude: number; longitude: number } }) => void;
let lastSuccessCb: SuccessCb | null = null;
const watchPosition = vi.fn((success: SuccessCb) => {
  lastSuccessCb = success;
  return 1; // watch id
});
const clearWatch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  lastSuccessCb = null;
  Object.defineProperty(globalThis.navigator, "geolocation", {
    configurable: true,
    value: { watchPosition, clearWatch },
  });
});

afterEach(() => {
  // Strip the geolocation stub so unrelated tests in the same worker see the
  // default jsdom shape (undefined).
  Object.defineProperty(globalThis.navigator, "geolocation", {
    configurable: true,
    value: undefined,
  });
});

describe("useUserGeolocation", () => {
  it("removes the user marker and nulls the ref on unmount (prevents detached-DOM leak)", () => {
    const mapRef = makeMapRef() as unknown as React.MutableRefObject<MapboxMap | null>;
    const { unmount } = renderHook(() => useUserGeolocation({ map: mapRef }));

    // Drive a GPS lock so the marker-creation effect runs and attaches a
    // Marker via addTo(). Without an emitted position the marker would never
    // mount and the cleanup assertion would false-pass.
    act(() => {
      lastSuccessCb?.({ coords: { latitude: 34.05, longitude: -118.25 } });
    });
    expect(markerAddTo).toHaveBeenCalledTimes(1);
    expect(markerRemove).not.toHaveBeenCalled();

    unmount();

    // Marker must be detached exactly once on unmount — otherwise the DOM
    // node persists across every map remount (style reload, tile-load retry).
    expect(markerRemove).toHaveBeenCalledTimes(1);
  });
});
