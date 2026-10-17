/**
 * The two referee sweeps (expired turns, expired disputes) stay on Vercel,
 * where their logic and tests live. The scheduled function is now their clock,
 * replacing the GitHub Actions cron that curled them.
 */

export const REFEREE_BASE_URL = "https://skatehubba.com";
export const REFEREE_PATHS = ["/api/cron/sweep-expired-turns", "/api/cron/resolve-expired-disputes"] as const;

/** Run the referees every third 5-minute tick (same as the old workflow). */
export function refereesDue(nowMs: number): boolean {
  return new Date(nowMs).getUTCMinutes() % 15 < 5;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

export interface RefereeResult {
  path: string;
  ok: boolean;
  status: number | null;
}

/** Call each referee endpoint. Never throws; one failure does not skip the other. */
export async function runReferees(
  secret: string,
  fetchFn: FetchLike,
  warn: (event: string, fields: Record<string, unknown>) => void,
): Promise<RefereeResult[]> {
  if (!secret) {
    warn("referee_secret_missing", {});
    return REFEREE_PATHS.map((path) => ({ path, ok: false, status: null }));
  }
  const results: RefereeResult[] = [];
  for (const path of REFEREE_PATHS) {
    try {
      const res = await fetchFn(`${REFEREE_BASE_URL}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(240_000),
      });
      if (!res.ok) warn("referee_failed", { path, status: res.status });
      results.push({ path, ok: res.ok, status: res.status });
    } catch (err) {
      warn("referee_failed", { path, message: err instanceof Error ? err.message : String(err) });
      results.push({ path, ok: false, status: null });
    }
  }
  return results;
}
