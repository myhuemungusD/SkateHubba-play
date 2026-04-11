export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

// SkateHubba dark map style.
// Uses the Mapbox `dark-v11` style as a default until the custom SkateHubba
// Studio style is authored and its URL is provided via VITE_MAPBOX_STYLE_URL.
export const MAP_STYLE =
  (import.meta.env.VITE_MAPBOX_STYLE_URL as string | undefined) ?? "mapbox://styles/mapbox/dark-v11";

export const MAP_DEFAULTS = {
  zoom: 13,
  minZoom: 5,
  maxZoom: 19,
} as const;
