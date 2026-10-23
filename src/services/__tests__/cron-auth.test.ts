/**
 * api/cron/_cronAuth.ts: the shared constant-time `Bearer ${CRON_SECRET}`
 * check behind every cron (drain-push-dispatch, resolve-expired-disputes,
 * sweep-expired-turns, and the WTT stubs). Fail-closed throughout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCronAuthorized, matchesCronSecret } from "../../../api/cron/_cronAuth.js";

const SECRET = "unit-cron-secret";

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("matchesCronSecret", () => {
  it("accepts exactly `Bearer ${CRON_SECRET}`", () => {
    expect(matchesCronSecret(`Bearer ${SECRET}`)).toBe(true);
  });

  it.each([
    ["undefined", undefined],
    ["an empty string", ""],
    ["the wrong secret", "Bearer wrong-secret"],
    ["a same-length wrong value", `Bearer ${"z".repeat(SECRET.length)}`],
    ["the secret without the Bearer scheme", SECRET],
    ["a lowercase scheme", `bearer ${SECRET}`],
    ["trailing whitespace", `Bearer ${SECRET} `],
  ])("rejects %s", (_label, value) => {
    expect(matchesCronSecret(value)).toBe(false);
  });

  it("fails closed when CRON_SECRET is unset", () => {
    vi.stubEnv("CRON_SECRET", undefined);
    expect(matchesCronSecret("Bearer undefined")).toBe(false);
    expect(matchesCronSecret("Bearer ")).toBe(false);
  });

  it("fails closed when CRON_SECRET is empty", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(matchesCronSecret("Bearer ")).toBe(false);
  });
});

describe("isCronAuthorized (Web Request)", () => {
  const make = (authorization?: string) =>
    new Request("https://example.test/api/cron/", {
      headers: authorization === undefined ? {} : { authorization },
    });

  it("reads the Authorization header (case-insensitively) and accepts the secret", () => {
    expect(isCronAuthorized(make(`Bearer ${SECRET}`))).toBe(true);
    expect(
      isCronAuthorized(new Request("https://example.test/", { headers: { AUTHORIZATION: `Bearer ${SECRET}` } })),
    ).toBe(true);
  });

  it("rejects a missing or wrong header", () => {
    expect(isCronAuthorized(make())).toBe(false);
    expect(isCronAuthorized(make("Bearer nope"))).toBe(false);
  });
});
