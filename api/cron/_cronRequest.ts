/**
 * Request plumbing shared by the Node-signature crons: the minimal req/res
 * shapes, the CRON_SECRET bearer check and the dry-run switch. One copy, so the
 * auth and dry-run behavior of every cron stays identical.
 *
 * The underscore prefix keeps Vercel's filesystem router from exposing this
 * module as an endpoint.
 */
import { matchesCronSecret } from "./_cronAuth.js";

/** Minimal request/response shape — avoids a hard dep on @vercel/node types. */
export interface CronRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  url?: string;
}
export interface CronResponse {
  status: (code: number) => CronResponse;
  json: (body: unknown) => void;
}

/**
 * Constant-time bearer check against CRON_SECRET, fail-closed. The comparison
 * lives in ./_cronAuth.ts; this only picks the header value off the request.
 */
export function isAuthorized(req: CronRequest): boolean {
  const header = req.headers["authorization"] ?? req.headers["Authorization"];
  return matchesCronSecret(Array.isArray(header) ? header[0] : header);
}

/** `?dryRun=1|true` or DRY_RUN=1|true: log intended writes, write nothing. */
export function isDryRun(req: CronRequest): boolean {
  if (process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true") return true;
  const q = req.query?.["dryRun"];
  const value = Array.isArray(q) ? q[0] : q;
  if (value === "1" || value === "true") return true;
  // Fall back to parsing the raw URL when the platform didn't pre-parse query.
  if (req.url && /[?&]dryRun=(1|true)\b/.test(req.url)) return true;
  return false;
}
