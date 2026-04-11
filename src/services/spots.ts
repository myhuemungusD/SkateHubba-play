/**
 * Thin client for the spots HTTP API (apps/api/src/routes/spots.ts).
 *
 * The full Spot type lives in the monorepo @shared/types package, which is
 * not a dependency of the root S.K.A.T.E. game app. This service intentionally
 * exposes only the narrow surface the game flow actually needs — currently
 * just resolving a spot id to a display name for the challenge context chip.
 * Keeping the return shape minimal here avoids coupling src/ to apps/ types.
 */

import { logger } from "./logger";
import { captureException } from "../lib/sentry";

interface SpotNameResponse {
  id: string;
  name: string;
}

/**
 * Fetch a spot's display name by id. Returns `null` on any error (network,
 * 404, malformed response, abort) — this is a best-effort lookup used to
 * decorate UI and must never block the core flow.
 *
 * Failure telemetry:
 *   - AbortError (component unmount) is expected and silent.
 *   - Non-ok HTTP (404, 5xx) is expected-ish and not paged to Sentry —
 *     the server already logs these, and a stale shared link is a
 *     legitimate cause.
 *   - Everything else (TypeError from a failed DNS, malformed JSON, etc.)
 *     is an unexpected client-side fault and gets both a structured log
 *     and a Sentry capture so we can diagnose in production.
 *
 * @param spotId  UUID of the spot
 * @param signal  optional AbortSignal so callers can cancel in flight on unmount
 */
export async function fetchSpotName(spotId: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`/api/spots/${encodeURIComponent(spotId)}`, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<SpotNameResponse>;
    if (typeof data?.name !== "string" || data.name.length === 0) return null;
    return data.name;
  } catch (err) {
    // AbortError is expected on unmount — don't spam logs
    if (err instanceof DOMException && err.name === "AbortError") return null;
    logger.warn("fetch_spot_name_failed", {
      spotId,
      error: err instanceof Error ? err.message : "unknown",
    });
    captureException(err, { tags: { op: "fetchSpotName" }, extra: { spotId } });
    return null;
  }
}
