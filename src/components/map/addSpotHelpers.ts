import type { ObstacleType } from "../../types/spot";

/** Only allow https URLs for photo submissions */
export function isValidPhotoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Sink-side guard for the photo preview `<img src>`. `addPhotoUrl` already
 * rejects non-https input, but the preview renders straight from component
 * state, so the sink re-checks rather than trusting every future writer of
 * `photoUrls`. The URL is parsed and only an https URL passes; the `src` is
 * then rebuilt behind a fixed `https://` prefix, so no other scheme
 * (javascript:, data:, blob:, …) can ever reach the attribute. Anything
 * unparseable or non-https yields `undefined`, so the `<img>` renders with
 * no `src` and never loads it.
 */
export function safePhotoPreviewSrc(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  return `https://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Parse a coordinate input string into a number, or NaN when the parse
 * fails (empty, "-", etc.). NaN is intentional — callers keep it in
 * state so the submit guard's Number.isFinite check rejects empty input
 * rather than silently zeroing the pin into the Atlantic.
 */
export function parseCoord(raw: string): number {
  const next = Number.parseFloat(raw);
  return Number.isFinite(next) ? next : NaN;
}

export const ALL_OBSTACLES: ObstacleType[] = [
  "ledge",
  "rail",
  "stairs",
  "gap",
  "bank",
  "bowl",
  "manual_pad",
  "quarter_pipe",
  "euro_gap",
  "slappy_curb",
  "hip",
  "hubba",
  "flatground",
  "other",
];

/** Finite and inside Earth's lat/lng range. NaN (a half-typed input) fails. */
export function isValidLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
