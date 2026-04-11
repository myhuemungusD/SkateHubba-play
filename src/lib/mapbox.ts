export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

// SkateHubba dark map style
// TODO: Replace with custom Mapbox Studio style URL once designed.
// Assumption: using mapbox dark-v11 as placeholder until Studio style ships.
export const MAP_STYLE =
  (import.meta.env.VITE_MAPBOX_STYLE_URL as string | undefined) ?? "mapbox://styles/mapbox/dark-v11";

export const MAP_DEFAULTS = {
  zoom: 13,
  minZoom: 5,
  maxZoom: 19,
} as const;
