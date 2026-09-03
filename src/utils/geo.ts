/**
 * Pure geodesic helpers for the "spots near me" feature.
 *
 * Kept dependency-free on purpose: a haversine + a bounding-box is all the
 * nearby list needs, and it lets `getSpotsNearby` reuse the existing
 * latitude-range Firestore query instead of pulling in geohash tooling.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Mean Earth radius in kilometres (WGS-84 spherical approximation). */
const EARTH_RADIUS_KM = 6371.0088;

/** Kilometres per degree of arc on the sphere above (≈111.195). */
const KM_PER_DEG = (EARTH_RADIUS_KM * Math.PI) / 180;

/**
 * Over-size the bounding box by this factor so it always contains the
 * circle: the east/west edge along a parallel is slightly shorter than a
 * great-circle path of the same longitude delta. The caller's haversine
 * check trims the excess.
 */
const BOUNDS_PAD = 1.01;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface LatLngBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * Axis-aligned box that fully contains a circle of `radiusKm` around `center`.
 * Latitude edges are clamped to the poles; longitude edges are clamped to
 * ±180 (no antimeridian wrap — a spot search at the dateline just gets a
 * truncated box, which is acceptable for this feature).
 */
export function boundsAroundPoint(center: LatLng, radiusKm: number): LatLngBounds {
  const padded = radiusKm * BOUNDS_PAD;
  const dLat = padded / KM_PER_DEG;
  // Near the poles cos(lat) → 0; floor it so the box never blows up to NaN/∞.
  const cosLat = Math.max(Math.cos(toRad(center.lat)), 0.01);
  const dLng = padded / (KM_PER_DEG * cosLat);
  return {
    north: Math.min(90, center.lat + dLat),
    south: Math.max(-90, center.lat - dLat),
    east: Math.min(180, center.lng + dLng),
    west: Math.max(-180, center.lng - dLng),
  };
}

/**
 * Human-readable distance: "350 m" under 1 km, "2.4 km" under 10 km,
 * otherwise whole kilometres. Rounds before picking the unit so the
 * boundaries never render as "1000 m" or "10.0 km".
 */
export function formatDistance(km: number): string {
  const metres = Math.round(km * 1000);
  if (metres < 1000) return `${metres} m`;
  const tenths = Math.round(km * 10) / 10;
  if (tenths < 10) return `${tenths.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}
