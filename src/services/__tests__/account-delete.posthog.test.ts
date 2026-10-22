/**
 * PostHog person erasure (`api/account/_posthogErasure.ts`). Fetch is always
 * injected, so nothing here touches the network.
 */
import { describe, it, expect, vi } from "vitest";
import { erasePosthogPerson, POSTHOG_DEFAULT_HOST, POSTHOG_TIMEOUT_MS } from "../../../api/account/_posthogErasure";
import { hashIdentity } from "../../utils/pii";

const UID = "uid-of-caller";
const ENV = { POSTHOG_PERSONAL_API_KEY: "phx_test_key", POSTHOG_PROJECT_ID: "12345" };

function okFetch(body: unknown = { persons_found: 1, persons_queued_for_deletion: 1 }) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 200 }));
}

describe("erasePosthogPerson", () => {
  it("skips without calling fetch when the key or project id is missing or blank", async () => {
    const fetchImpl = okFetch();
    for (const env of [
      {},
      { POSTHOG_PERSONAL_API_KEY: "k" },
      { POSTHOG_PROJECT_ID: "1" },
      { ...ENV, POSTHOG_PERSONAL_API_KEY: "  " },
    ]) {
      expect(await erasePosthogPerson(UID, { env, fetchImpl })).toEqual({
        status: "skipped",
        reason: "not_configured",
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bulk-deletes the surrogate distinct_id with its events on the default host", async () => {
    const fetchImpl = okFetch();
    const out = await erasePosthogPerson(UID, { env: ENV, fetchImpl });
    expect(out).toEqual({ status: "queued", personsFound: 1 });
    const [url, init = {}] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${POSTHOG_DEFAULT_HOST}/api/projects/12345/persons/bulk_delete/`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer phx_test_key", "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ distinct_ids: [hashIdentity(UID)], delete_events: true });
    expect(String(init.body)).not.toContain(UID);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("honours POSTHOG_HOST, trimming trailing slashes, and encodes the project id", async () => {
    const fetchImpl = okFetch();
    await erasePosthogPerson(UID, {
      env: { ...ENV, POSTHOG_PROJECT_ID: "a/b", POSTHOG_HOST: "https://eu.posthog.com//" },
      fetchImpl,
    });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://eu.posthog.com/api/projects/a%2Fb/persons/bulk_delete/");
  });

  it("reads process.env and the global fetch by default", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(okFetch({ persons_found: 0 }));
    vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "k");
    vi.stubEnv("POSTHOG_PROJECT_ID", "9");
    vi.stubEnv("POSTHOG_HOST", "");
    try {
      expect(await erasePosthogPerson(UID)).toEqual({ status: "queued", personsFound: 0 });
      expect(fetchSpy.mock.calls[0][0]).toBe(`${POSTHOG_DEFAULT_HOST}/api/projects/9/persons/bulk_delete/`);
    } finally {
      vi.unstubAllEnvs();
      fetchSpy.mockRestore();
    }
  });

  it("treats a missing or non-numeric persons_found, or a non-JSON body, as zero", async () => {
    expect(await erasePosthogPerson(UID, { env: ENV, fetchImpl: okFetch({}) })).toEqual({
      status: "queued",
      personsFound: 0,
    });
    const notJson = vi.fn(async () => new Response("ok", { status: 200 }));
    expect(await erasePosthogPerson(UID, { env: ENV, fetchImpl: notJson })).toEqual({
      status: "queued",
      personsFound: 0,
    });
  });

  it("reports a non-2xx response as failed with only the status", async () => {
    const fetchImpl = vi.fn(async () => new Response("forbidden: phx_test_key", { status: 403 }));
    expect(await erasePosthogPerson(UID, { env: ENV, fetchImpl })).toEqual({ status: "failed", reason: "http_403" });
  });

  it("never throws: network errors and timeouts become failed with the error name only", async () => {
    const network = vi.fn(async () => {
      throw new TypeError("fetch failed for Bearer phx_test_key");
    });
    expect(await erasePosthogPerson(UID, { env: ENV, fetchImpl: network })).toEqual({
      status: "failed",
      reason: "TypeError",
    });
    const odd = vi.fn(async () => {
      throw "boom";
    });
    expect(await erasePosthogPerson(UID, { env: ENV, fetchImpl: odd })).toEqual({
      status: "failed",
      reason: "unknown",
    });
  });

  it("aborts a hung request after the timeout", async () => {
    const hung = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
        ),
    );
    const out = await erasePosthogPerson(UID, { env: ENV, fetchImpl: hung as unknown as typeof fetch, timeoutMs: 10 });
    expect(out).toEqual({ status: "failed", reason: "TimeoutError" });
    expect(POSTHOG_TIMEOUT_MS).toBe(5_000);
  });
});
