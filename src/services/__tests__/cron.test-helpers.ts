/**
 * Shared harness for the `api/cron/*` serverless handler tests.
 *
 * Both cron handlers (`sweep-expired-turns`, `drain-push-dispatch`) present the
 * same platform-agnostic contract: a minimal request/response pair, a
 * `Bearer ${CRON_SECRET}` header, and a service-account JSON in env. Extracted
 * here so the two test files share one definition instead of drifting apart —
 * and so `check:test-dup` stays honest about what is genuinely duplicated.
 *
 * Not production code; excluded from coverage by the `*test-helpers*` pattern
 * in vite.config.ts.
 */

import { expect, vi } from "vitest";

/** Records what the handler wrote to the response. */
export interface ResponseCapture {
  code?: number;
  body?: Record<string, unknown>;
}

export interface CronResponseDouble {
  status: (code: number) => CronResponseDouble;
  json: (body: unknown) => void;
}

/** A response double that records the status code and JSON body. */
export function makeRes(): { res: CronResponseDouble; out: ResponseCapture } {
  const out: ResponseCapture = {};
  const res: CronResponseDouble = {
    status(code: number) {
      out.code = code;
      return res;
    },
    json(body: unknown) {
      out.body = body as Record<string, unknown>;
    },
  };
  return { res, out };
}

export interface ReqOpts {
  authorization?: string;
  query?: Record<string, string | string[] | undefined>;
  url?: string;
  /** HTTP verb. Defaults to "GET" (the only verb the cron platform issues). */
  method?: string;
}

export interface CronRequestDouble {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  url?: string;
}

/** Build a request double. Omitting `authorization` exercises the fail-closed path. */
export function makeReq(opts: ReqOpts = {}): CronRequestDouble {
  const headers: Record<string, string | string[] | undefined> = {};
  if (opts.authorization !== undefined) headers.authorization = opts.authorization;
  return { method: opts.method ?? "GET", headers, query: opts.query, url: opts.url };
}

/** A structurally-valid service account. Never a real key. */
export const VALID_SERVICE_ACCOUNT = JSON.stringify({
  project_id: "demo",
  client_email: "svc@demo.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
});

/**
 * A malformed FIREBASE_SERVICE_ACCOUNT_JSON short enough that Node 22's
 * JSON.parse quotes the whole input — fake key marker included — in its message.
 */
export const MALFORMED_KEY_JSON = '{"pk":PRIVATE KEY}';

/**
 * Set MALFORMED_KEY_JSON as the service account, run `act` with console.warn
 * captured, and assert the init failure reaches neither the response nor the
 * log: flat body, error class + fixed reason only.
 */
export async function expectRedactedInitFailure(out: ResponseCapture, act: () => Promise<void>): Promise<void> {
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = MALFORMED_KEY_JSON;
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await act();
    expect(out.code).toBe(500);
    expect(out.body).toEqual({ error: "init_failed", message: "Server misconfiguration." });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("PRIVATE KEY");
    expect(warnSpy).toHaveBeenCalledWith(
      JSON.stringify({ event: "init_failed", errorName: "SyntaxError", reason: "service account JSON invalid" }),
    );
  } finally {
    warnSpy.mockRestore();
  }
}
