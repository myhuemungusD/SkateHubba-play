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

/** Kilometres per degree of latitude (constant everywhere on the sphere). */
const KM_PER_DEG_LAT = 111.32;

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
  const dLat = radiusKm / KM_PER_DEG_LAT;
  // Near the poles cos(lat) → 0; floor it so the box never blows up to NaN/∞.
  const cosLat = Math.max(Math.cos(toRad(center.lat)), 0.01);
  const dLng = radiusKm / (KM_PER_DEG_LAT * cosLat);
  return {
    north: Math.min(90, center.lat + dLat),
    south: Math.max(-90, center.lat - dLat),
    east: Math.min(180, center.lng + dLng),
    west: Math.max(-180, center.lng - dLng),
  };
}

/** Human-readable distance: "350 m" under 1 km, otherwise "2.4 km". */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}
