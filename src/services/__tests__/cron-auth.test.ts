/**
 * api/cron/_cronAuth.ts: the shared constant-time `Bearer ${CRON_SECRET}`
 * check behind every cron (drain-push-dispatch, resolve-expired-disputes,
 * sweep-expired-turns). Fail-closed throughout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchesCronSecret } from "../../../api/cron/_cronAuth.js";

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
