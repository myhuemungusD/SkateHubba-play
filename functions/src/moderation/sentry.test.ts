import { describe, expect, it, vi } from "vitest";
import { captureModerationFailure, parseSentryDsn } from "./sentry.js";

describe("parseSentryDsn", () => {
  it("parses a DSN and rejects an empty or broken one", () => {
    expect(parseSentryDsn("")).toBeNull();
    expect(parseSentryDsn("not a url")).toBeNull();
    expect(parseSentryDsn("https://o123.ingest.sentry.io/1")).toBeNull();
    expect(parseSentryDsn("https://abc@o123.ingest.sentry.io/456")).toEqual({
      key: "abc",
      storeUrl: "https://o123.ingest.sentry.io/api/456/store/",
    });
  });
});

describe("captureModerationFailure", () => {
  it("posts the error when a DSN is set and skips when it is not", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }) as Response);
    await expect(captureModerationFailure("", new Error("boom"), { clipId: "c" }, fetchImpl)).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(
      captureModerationFailure("https://abc@o123.ingest.sentry.io/456", "plain", { clipId: "c1" }, fetchImpl),
    ).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.body)).toContain("plain");
    expect(String(init.headers && (init.headers as Record<string, string>)["X-Sentry-Auth"])).toContain(
      "sentry_key=abc",
    );
  });
});
