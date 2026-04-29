// Typed as `string | undefined` on purpose: the build does not fail when the
// token is missing (previews/forks don't have it), and the consuming code must
// treat that case explicitly. See SpotMap.tsx for the fallback render path.
export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

// SkateHubba dark map style fallback — used when VITE_MAPBOX_STYLE_URL is
// unset OR set to an invalid value. Replace by designing a custom style in
// Mapbox Studio and pointing VITE_MAPBOX_STYLE_URL at it (no code change).
export const DEFAULT_MAP_STYLE = "mapbox://styles/mapbox/dark-v11";

/**
 * A value is acceptable to pass to `new mapboxgl.Map({ style })` when it is
 * either a Mapbox-hosted style URI (`mapbox://styles/<owner>/<style-id>`) or
 * an https URL pointing at a self-hosted style JSON. Anything else — http
 * URLs, relative paths, typo'd schemes — is rejected here so a misconfigured
 * env var falls back to the default style instead of silently breaking the
 * map (mapbox-gl swallows the load error and the overlay sticks forever).
 */
export function isValidStyleUrl(value: string): boolean {
  if (value.startsWith("mapbox://styles/")) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function resolveMapStyle(): string {
  const override = import.meta.env.VITE_MAPBOX_STYLE_URL as string | undefined;
  if (!override) return DEFAULT_MAP_STYLE;
  if (isValidStyleUrl(override)) return override;
  console.warn(
    `[mapbox] Ignoring invalid VITE_MAPBOX_STYLE_URL — must start with "mapbox://styles/" or be an https URL. Falling back to ${DEFAULT_MAP_STYLE}.`,
  );
  return DEFAULT_MAP_STYLE;
}

export const MAP_STYLE = resolveMapStyle();

export const MAP_DEFAULTS = {
  zoom: 13,
  minZoom: 5,
  maxZoom: 19,
} as const;
