import { describe, it, expect } from "vitest";
import { haversineKm, boundsAroundPoint, formatDistance } from "../geo";

const LA = { lat: 34.0522, lng: -118.2437 };
const SF = { lat: 37.7749, lng: -122.4194 };

describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineKm(LA, LA)).toBe(0);
  });

  it("matches the known LA→SF great-circle distance within 1%", () => {
    // Published great-circle distance is ~559 km.
    const d = haversineKm(LA, SF);
    expect(d).toBeGreaterThan(553);
    expect(d).toBeLessThan(565);
  });

  it("is symmetric", () => {
    expect(haversineKm(LA, SF)).toBeCloseTo(haversineKm(SF, LA), 9);
  });

  it("clamps antipodal rounding so asin never receives > 1", () => {
    const d = haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeCloseTo(Math.PI * 6371.0088, 3);
  });
});

describe("boundsAroundPoint", () => {
  it("builds a box whose corners are at least radiusKm from the center", () => {
    const b = boundsAroundPoint(LA, 10);
    expect(haversineKm(LA, { lat: b.north, lng: LA.lng })).toBeCloseTo(10, 0);
    expect(haversineKm(LA, { lat: LA.lat, lng: b.east })).toBeCloseTo(10, 0);
    expect(b.north).toBeGreaterThan(b.south);
    expect(b.east).toBeGreaterThan(b.west);
  });

  it("clamps latitude to the poles and longitude to ±180", () => {
    const b = boundsAroundPoint({ lat: 89.99, lng: 179.99 }, 50);
    expect(b.north).toBe(90);
    expect(b.east).toBe(180);
    const s = boundsAroundPoint({ lat: -89.99, lng: -179.99 }, 50);
    expect(s.south).toBe(-90);
    expect(s.west).toBe(-180);
  });

  it("never produces NaN at the exact pole", () => {
    const b = boundsAroundPoint({ lat: 90, lng: 0 }, 1);
    expect(Number.isFinite(b.east)).toBe(true);
    expect(Number.isFinite(b.west)).toBe(true);
  });
});

describe("formatDistance", () => {
  it("uses metres under 1 km", () => {
    expect(formatDistance(0.35)).toBe("350 m");
    expect(formatDistance(0)).toBe("0 m");
  });

  it("uses one decimal between 1 and 10 km", () => {
    expect(formatDistance(2.44)).toBe("2.4 km");
    expect(formatDistance(1)).toBe("1.0 km");
  });

  it("rounds to whole km at 10 km and above", () => {
    expect(formatDistance(10)).toBe("10 km");
    expect(formatDistance(12.6)).toBe("13 km");
  });
});
