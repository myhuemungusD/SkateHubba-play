import { describe, expect, it, vi } from "vitest";
import { refereesDue, runReferees } from "./referees.js";

describe("refereesDue", () => {
  it("fires in the first 5 minutes of each quarter hour", () => {
    expect(refereesDue(Date.UTC(2026, 0, 1, 0, 0))).toBe(true);
    expect(refereesDue(Date.UTC(2026, 0, 1, 0, 19))).toBe(true);
    expect(refereesDue(Date.UTC(2026, 0, 1, 0, 5))).toBe(false);
    expect(refereesDue(Date.UTC(2026, 0, 1, 0, 44))).toBe(false);
  });
});

describe("runReferees", () => {
  it("calls both endpoints with the bearer secret", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200 }));
    const warn = vi.fn();
    const r = await runReferees("s3", fetchFn, warn);
    expect(r).toEqual([
      { path: "/api/cron/sweep-expired-turns", ok: true, status: 200 },
      { path: "/api/cron/resolve-expired-disputes", ok: true, status: 200 },
    ]);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://skatehubba.com/api/cron/sweep-expired-turns",
      expect.objectContaining({ method: "GET", headers: { Authorization: "Bearer s3" } }),
    );
    expect(warn).not.toHaveBeenCalled();
  });
  it("keeps going after a failure and warns", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("net"))
      .mockRejectedValueOnce("raw")
      .mockResolvedValueOnce({ ok: false, status: 401 });
    const warn = vi.fn();
    expect(await runReferees("s", fetchFn, warn)).toEqual([
      { path: "/api/cron/sweep-expired-turns", ok: false, status: null },
      { path: "/api/cron/resolve-expired-disputes", ok: false, status: null },
    ]);
    expect(await runReferees("s", fetchFn, warn)).toEqual([
      { path: "/api/cron/sweep-expired-turns", ok: false, status: 401 },
      { path: "/api/cron/resolve-expired-disputes", ok: false, status: null },
    ]);
    expect(warn).toHaveBeenCalledWith("referee_unauthorized", {
      path: "/api/cron/sweep-expired-turns",
      status: 401,
      hint: "CRON_SECRET mismatch with Vercel",
    });
  });
  it("warns referee_failed on a non-401 error status", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 500 }));
    const warn = vi.fn();
    await runReferees("s", fetchFn, warn);
    expect(warn).toHaveBeenCalledWith("referee_failed", { path: "/api/cron/sweep-expired-turns", status: 500 });
  });
  it("trims whitespace around the secret", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200 }));
    await runReferees(" s3\n", fetchFn, vi.fn());
    expect(fetchFn).toHaveBeenCalledWith(
      "https://skatehubba.com/api/cron/sweep-expired-turns",
      expect.objectContaining({ headers: { Authorization: "Bearer s3" } }),
    );
  });
  it("does nothing without a secret", async () => {
    const fetchFn = vi.fn();
    const warn = vi.fn();
    const r = await runReferees("  \n", fetchFn, warn);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(r.every((x) => !x.ok)).toBe(true);
    expect(warn).toHaveBeenCalledWith("referee_secret_missing", {});
  });
});
