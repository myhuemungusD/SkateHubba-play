// Typed as `string | undefined` on purpose: the build does not fail when the
// token is missing (previews/forks don't have it), and the consuming code must
// treat that case explicitly. See SpotMap.tsx for the fallback render path.
import { captureMessage } from "./sentry";

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

interface ResolvedMapStyle {
  /** The style URL to hand to mapbox-gl. Always a valid value. */
  url: string;
  /**
   * The original env-var value when it was set but rejected, so the consumer
   * can surface it to Sentry/console with the offending input attached.
   * `null` when the override was unset or accepted.
   */
  invalidOverride: string | null;
}

function resolveMapStyle(): ResolvedMapStyle {
  const raw = import.meta.env.VITE_MAPBOX_STYLE_URL as string | undefined;
  // Trim because Vercel's env editor and shell-redirected `.env` files are
  // both happy to ship trailing whitespace, and a stray space would otherwise
  // demote a perfectly valid URL to "invalid".
  const override = raw?.trim();
  if (!override) return { url: DEFAULT_MAP_STYLE, invalidOverride: null };
  if (isValidStyleUrl(override)) return { url: override, invalidOverride: null };
  return { url: DEFAULT_MAP_STYLE, invalidOverride: override };
}

const resolved = resolveMapStyle();
export const MAP_STYLE = resolved.url;

/**
 * Surface a misconfigured `VITE_MAPBOX_STYLE_URL` to both the operator's
 * console and Sentry. Idempotent — safe to call from a `useEffect` that
 * may re-fire under StrictMode or remounts.
 *
 * Why this isn't called at module-init time: `initSentry()` resolves
 * asynchronously (it dynamically imports `@sentry/react`), so a synchronous
 * `captureMessage` from this file's top-level evaluation would no-op while
 * the SDK is still bootstrapping. Calling from `useEffect` defers past
 * first paint, by which point the SDK has typically resolved — same
 * pattern as `map_token_missing` in SpotMap.tsx.
 */
let mapStyleConfigReported = false;
export function reportMapStyleConfig(): void {
  if (mapStyleConfigReported) return;
  mapStyleConfigReported = true;
  if (!resolved.invalidOverride) return;
  console.warn(
    `[mapbox] Ignoring invalid VITE_MAPBOX_STYLE_URL — must start with "mapbox://styles/" or be an https URL. Falling back to ${DEFAULT_MAP_STYLE}.`,
  );
  captureMessage("map_style_invalid", {
    level: "warning",
    extra: { styleUrl: resolved.invalidOverride },
  });
}

export const MAP_DEFAULTS = {
  zoom: 13,
  minZoom: 5,
  maxZoom: 19,
} as const;
