export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

// SkateHubba dark map style
// Placeholder: using Mapbox `dark-v11` until a custom Mapbox Studio style
// is designed. Override via VITE_MAPBOX_STYLE_URL without touching code.
export const MAP_STYLE =
  (import.meta.env.VITE_MAPBOX_STYLE_URL as string | undefined) ?? "mapbox://styles/mapbox/dark-v11";

export const MAP_DEFAULTS = {
  zoom: 13,
  minZoom: 5,
  maxZoom: 19,
} as const;
