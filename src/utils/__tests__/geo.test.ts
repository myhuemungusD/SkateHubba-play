import { describe, it, expect } from "vitest";
import { haversineKm, boundsAroundPoint, formatDistance } from "../geo";

const LA = { lat: 34.0522, lng: -118.2437 };
const SF = { lat: 37.7749, lng: -122.4194 };
const R = 6371.0088;

/** Great-circle destination point — independent check for the bounds test. */
function destination(from: { lat: number; lng: number }, km: number, bearingDeg: number) {
  const φ1 = (from.lat * Math.PI) / 180;
  const λ1 = (from.lng * Math.PI) / 180;
  const θ = (bearingDeg * Math.PI) / 180;
  const δ = km / R;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: (φ2 * 180) / Math.PI, lng: (λ2 * 180) / Math.PI };
}

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
  it("builds a box whose edges are at least radiusKm from the center (never short)", () => {
    const b = boundsAroundPoint(LA, 10);
    const north = haversineKm(LA, { lat: b.north, lng: LA.lng });
    const east = haversineKm(LA, { lat: LA.lat, lng: b.east });
    expect(north).toBeGreaterThanOrEqual(10);
    expect(east).toBeGreaterThanOrEqual(10);
    // …but not wastefully oversized either.
    expect(north).toBeLessThan(10.2);
    expect(east).toBeLessThan(10.2);
    expect(b.north).toBeGreaterThan(b.south);
    expect(b.east).toBeGreaterThan(b.west);
  });

  it("contains every point on the radius circle, including diagonals", () => {
    const b = boundsAroundPoint(LA, 10);
    for (let bearing = 0; bearing < 360; bearing += 15) {
      const p = destination(LA, 10, bearing);
      expect(p.lat).toBeLessThanOrEqual(b.north);
      expect(p.lat).toBeGreaterThanOrEqual(b.south);
      expect(p.lng).toBeLessThanOrEqual(b.east);
      expect(p.lng).toBeGreaterThanOrEqual(b.west);
    }
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
    expect(formatDistance(0.9994)).toBe("999 m");
  });

  it("uses one decimal between 1 and 10 km", () => {
    expect(formatDistance(2.44)).toBe("2.4 km");
    expect(formatDistance(1)).toBe("1.0 km");
  });

  it("rounds to whole km at 10 km and above", () => {
    expect(formatDistance(10)).toBe("10 km");
    expect(formatDistance(12.6)).toBe("13 km");
  });

  it("never renders '1000 m' or '10.0 km' at the unit boundaries", () => {
    expect(formatDistance(0.9996)).toBe("1.0 km");
    expect(formatDistance(9.96)).toBe("10 km");
  });
});
