/**
 * The WTT stub crons (`api/cron/build-wtt-items.ts`, `api/cron/wtt-nightly-em.ts`)
 * while WTT is disabled: cron auth first (401), then verb (405), then an
 * immediate 204. They must use the Web signature (`export default { fetch }`):
 * Vercel runs a default-exported function as a Node `(req, res)` handler and
 * drops its returned Response, so the request hung until the function timed out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import buildWttItemsModule, { buildWttItems } from "../../../api/cron/build-wtt-items.js";
import wttNightlyEmModule, { wttNightlyEm } from "../../../api/cron/wtt-nightly-em.js";

const SECRET = "test-cron-secret";
const URL_BASE = "https://example.test/api/cron/";

function req(method = "GET", authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request(URL_BASE, { method, headers });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each([
  ["build-wtt-items", buildWttItemsModule, buildWttItems],
  ["wtt-nightly-em", wttNightlyEmModule, wttNightlyEm],
])("%s (stub, WTT disabled)", (_name, mod, handler) => {
  it("default-exports the Web fetch form, not a (req, res) function", () => {
    expect(typeof mod).toBe("object");
    expect(mod.fetch).toBe(handler);
  });

  it("returns 204 with no body for an authorized GET, without doing any work", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await mod.fetch(req("GET", `Bearer ${SECRET}`));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(log).not.toHaveBeenCalled();
  });

  it("returns 204 for an authorized POST", async () => {
    const res = await handler(req("POST", `Bearer ${SECRET}`));
    expect(res.status).toBe(204);
  });

  it.each([
    ["no Authorization header", undefined],
    ["an empty header", ""],
    ["the wrong secret", "Bearer not-the-secret"],
    ["the right length but wrong bytes", `Bearer ${"x".repeat(SECRET.length)}`],
    ["the secret without the Bearer scheme", SECRET],
  ])("returns 401 for %s", async (_label, authorization) => {
    const res = await handler(req("GET", authorization));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("fails closed with 401 when CRON_SECRET is unset, even for a matching-looking header", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await handler(req("GET", "Bearer "));
    expect(res.status).toBe(401);
  });

  it("checks auth before the verb, so an unauthenticated DELETE gets 401, not 405", async () => {
    const res = await handler(req("DELETE"));
    expect(res.status).toBe(401);
  });

  it("refuses other verbs with 405 once authorized", async () => {
    const res = await handler(req("DELETE", `Bearer ${SECRET}`));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "method_not_allowed" });
  });
});
