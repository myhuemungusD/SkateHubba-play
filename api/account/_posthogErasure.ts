/**
 * Deletes a departing user's PostHog person, and their events, after the
 * Firestore erasure has succeeded.
 *
 * The client identifies a profiled user to PostHog with `hashIdentity(uid)`
 * (`src/context/AuthContext.tsx`), so that surrogate is the distinct_id to
 * delete. PostHog's bulk_delete endpoint takes distinct_ids directly, which
 * saves a lookup round-trip; `delete_events: true` removes the events captured
 * before the request too. PostHog removes the person in the background, so a
 * 200 means "queued", not "gone".
 *
 * Best-effort by design. Account deletion must never fail, or wait long,
 * because an analytics vendor is down or unconfigured:
 *   - no key or project id: skipped, so the handler logs a warning;
 *   - non-2xx, network error or timeout: "failed", which the handler reports
 *     as a warning and moves on.
 * It never throws, and it never logs. The caller decides what to log and
 * logs only hashed ids. The personal API key needs the `person:write` scope.
 */

import { hashIdentity } from "../../src/utils/pii.js";

export const POSTHOG_DEFAULT_HOST = "https://us.posthog.com";
export const POSTHOG_TIMEOUT_MS = 5_000;

export type PosthogErasureOutcome =
  | { status: "skipped"; reason: "not_configured" }
  | { status: "queued"; personsFound: number }
  | { status: "failed"; reason: string };

export interface PosthogErasureOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function erasePosthogPerson(
  uid: string,
  opts: PosthogErasureOptions = {},
): Promise<PosthogErasureOutcome> {
  const env = opts.env ?? process.env;
  const key = env.POSTHOG_PERSONAL_API_KEY?.trim();
  const projectId = env.POSTHOG_PROJECT_ID?.trim();
  if (!key || !projectId) return { status: "skipped", reason: "not_configured" };

  const host = (env.POSTHOG_HOST?.trim() || POSTHOG_DEFAULT_HOST).replace(/\/+$/, "");
  const url = `${host}/api/projects/${encodeURIComponent(projectId)}/persons/bulk_delete/`;
  const doFetch = opts.fetchImpl ?? fetch;

  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ distinct_ids: [hashIdentity(uid)], delete_events: true }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? POSTHOG_TIMEOUT_MS),
    });
    if (!res.ok) return { status: "failed", reason: `http_${res.status}` };
    const body = (await res.json().catch(() => ({}))) as { persons_found?: unknown };
    const personsFound = typeof body.persons_found === "number" ? body.persons_found : 0;
    return { status: "queued", personsFound };
  } catch (err) {
    // Only the error's name: a message could echo the request, and the
    // request carries the key.
    return { status: "failed", reason: err instanceof Error ? err.name : "unknown" };
  }
}
