/**
 * Server-side Sentry wrapper (`api/_sentry.ts`).
 *
 * Pins the contract the Vercel functions rely on:
 *   • inert (and never imports the SDK) when SENTRY_DSN is unset,
 *   • nothing that identifies a person or authenticates anything leaves the
 *     function (emails, bearer tokens, JWTs, private keys, sensitive keys),
 *   • secret-bearing error messages can be redacted wholesale,
 *   • events are flushed before the handler's response / rethrow,
 *   • a broken or slow Sentry can never break a handler,
 *   • per-invocation event budget.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const s = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(),
  linkedErrorsIntegration: vi.fn(() => ({ name: "LinkedErrors" })),
}));
vi.mock("@sentry/node", () => s);

import {
  MAX_EVENTS_PER_INVOCATION,
  __resetSentryForTests,
  captureServerError,
  ensureSentry,
  flushServerErrors,
  scrubEvent,
  scrubString,
  withSentry,
} from "../../../api/_sentry";

type InitOptions = {
  dsn: string;
  environment: string;
  release?: string;
  sendDefaultPii: boolean;
  defaultIntegrations: boolean;
  skipOpenTelemetrySetup: boolean;
  beforeBreadcrumb: () => unknown;
  beforeSend: (e: Record<string, unknown>) => Record<string, unknown>;
};
const initOptions = (): InitOptions => s.init.mock.calls[0][0] as InitOptions;

const DSN = "https://publickey@o1.ingest.sentry.io/1";

beforeEach(() => {
  vi.clearAllMocks();
  __resetSentryForTests();
  delete process.env.SENTRY_DSN;
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  s.flush.mockResolvedValue(true);
});

afterEach(() => {
  delete process.env.SENTRY_DSN;
});

describe("without SENTRY_DSN", () => {
  it("never initialises the SDK and every export is a no-op", async () => {
    expect(await ensureSentry()).toBeNull();
    captureServerError("account_delete_erasure_failed", new Error("x"), { uid: "u1" });
    await flushServerErrors();
    expect(s.init).not.toHaveBeenCalled();
    expect(s.captureException).not.toHaveBeenCalled();
    expect(s.flush).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only DSN as unset", async () => {
    process.env.SENTRY_DSN = "   ";
    expect(await ensureSentry()).toBeNull();
    expect(s.init).not.toHaveBeenCalled();
  });

  it("withSentry passes results through and rethrows unchanged", async () => {
    const ok = vi.fn().mockResolvedValue(undefined);
    await withSentry("h", ok)("req", "res");
    expect(ok).toHaveBeenCalledWith("req", "res");

    const boom = new Error("boom");
    await expect(withSentry("h", () => Promise.reject(boom))("req", "res")).rejects.toBe(boom);
    expect(s.captureException).not.toHaveBeenCalled();
  });
});

describe("with SENTRY_DSN", () => {
  beforeEach(() => {
    process.env.SENTRY_DSN = DSN;
  });

  it("initialises once, privacy-first and without default integrations", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_GIT_COMMIT_SHA = "abc123";
    await ensureSentry();
    await ensureSentry();
    expect(s.init).toHaveBeenCalledTimes(1);
    const opts = initOptions();
    expect(opts).toMatchObject({
      dsn: DSN,
      environment: "production",
      release: "abc123",
      sendDefaultPii: false,
      defaultIntegrations: false,
      skipOpenTelemetrySetup: true,
    });
    expect(opts.beforeBreadcrumb()).toBeNull();
  });

  it("swallows an SDK init failure and stays inert", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    s.init.mockImplementationOnce(() => {
      throw new Error("bad dsn");
    });
    expect(await ensureSentry()).toBeNull();
    captureServerError("e", new Error("x"));
    expect(s.captureException).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("sentry_init_failed"));
    warn.mockRestore();
  });

  it("reports caught failures tagged with their log event name", async () => {
    await ensureSentry();
    const err = new Error("Firestore unavailable");
    captureServerError("account_delete_erasure_failed", err, { uid: "u1" });
    expect(s.captureException).toHaveBeenCalledWith(err, {
      level: "error",
      tags: { event: "account_delete_erasure_failed" },
      extra: { uid: "u1" },
      fingerprint: ["{{ default }}", "account_delete_erasure_failed"],
    });
  });

  it("wraps non-Error throwables and honours the warning level", async () => {
    await ensureSentry();
    captureServerError("drain_dispatch_failed", "quota", {}, { level: "warning" });
    const [reported, ctx] = s.captureException.mock.calls[0];
    expect((reported as Error).message).toBe("drain_dispatch_failed: quota");
    expect(ctx.level).toBe("warning");
  });

  it("redactMessage drops a secret-bearing message and stack entirely", async () => {
    await ensureSentry();
    const parseErr = new SyntaxError('Unexpected token, "-----BEGIN PRIVATE KEY-----MIIE" is not valid JSON');
    captureServerError("sweep_init_failed", parseErr, {}, { redactMessage: true });
    const reported = s.captureException.mock.calls[0][0] as Error;
    expect(reported).not.toBe(parseErr);
    expect(reported.message).toBe("sweep_init_failed (SyntaxError; message redacted)");
    expect(String(reported.stack)).not.toContain("BEGIN PRIVATE KEY");
  });

  it("scrubs sensitive fields passed as extra", async () => {
    await ensureSentry();
    captureServerError("e", new Error("x"), { uid: "u1", email: "a@b.co", idToken: "t", note: "mail a@b.co" });
    expect(s.captureException.mock.calls[0][1].extra).toEqual({
      uid: "u1",
      email: "[Filtered]",
      idToken: "[Filtered]",
      note: "mail [email]",
    });
  });

  it("caps events per invocation", async () => {
    const handler = withSentry("cron", async () => {
      for (let i = 0; i < MAX_EVENTS_PER_INVOCATION + 5; i++) captureServerError("game_failed", new Error(String(i)));
    });
    await handler({}, {});
    expect(s.captureException).toHaveBeenCalledTimes(MAX_EVENTS_PER_INVOCATION);
    // A new invocation gets a fresh budget.
    await handler({}, {});
    expect(s.captureException).toHaveBeenCalledTimes(MAX_EVENTS_PER_INVOCATION * 2);
  });

  it("never lets captureException or flush throw into the handler", async () => {
    await ensureSentry();
    s.captureException.mockImplementationOnce(() => {
      throw new Error("sdk bug");
    });
    s.flush.mockRejectedValueOnce(new Error("network"));
    expect(() => captureServerError("e", new Error("x"))).not.toThrow();
    await expect(flushServerErrors()).resolves.toBeUndefined();
    expect(s.flush).toHaveBeenCalledWith(2000);
  });

  it("withSentry reports an unhandled throw and flushes BEFORE rethrowing", async () => {
    const order: string[] = [];
    s.captureException.mockImplementation(() => void order.push("capture"));
    s.flush.mockImplementation(async () => {
      order.push("flush");
      return true;
    });
    const boom = new Error("unexpected");
    const wrapped = withSentry("account_delete", async () => {
      throw boom;
    });
    await expect(wrapped({}, {})).rejects.toBe(boom);
    expect(order).toEqual(["capture", "flush"]);
    expect(s.captureException.mock.calls[0][1].tags).toEqual({ event: "account_delete_unhandled" });
  });
});

describe("scrubbing", () => {
  it("scrubs emails, bearer tokens, JWTs and private keys from strings", () => {
    const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl";
    const out = scrubString(
      `user jason@example.com sent Bearer abc.def-123 and ${jwt} with -----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY----- tail`,
    );
    expect(out).toBe("user [email] sent Bearer [token] and [jwt] with [private-key] tail");
  });

  it("beforeSend strips user/request/breadcrumbs and deep-scrubs the event", async () => {
    process.env.SENTRY_DSN = DSN;
    await ensureSentry();
    const event = {
      event_id: "1",
      server_name: "host-123",
      user: { id: "u1", email: "a@b.co", ip_address: "1.2.3.4" },
      request: { headers: { authorization: "Bearer x" }, cookies: { s: "1" } },
      breadcrumbs: [{ message: "a@b.co" }],
      tags: { event: "account_delete_erasure_failed" },
      extra: { uid: "u1", headers: { Authorization: "Bearer y", cookie: "c" } },
      exception: { values: [{ type: "Error", value: "no user a@b.co (token eyJabcdefg.hijklmnop.qrstu)" }] },
    };
    const out = initOptions().beforeSend(event);
    expect(out).not.toHaveProperty("user");
    expect(out).not.toHaveProperty("request");
    expect(out).not.toHaveProperty("breadcrumbs");
    expect(out).not.toHaveProperty("server_name");
    expect(out.tags).toEqual({ event: "account_delete_erasure_failed" });
    expect(out.extra).toEqual({ uid: "u1", headers: { Authorization: "[Filtered]", cookie: "[Filtered]" } });
    expect(JSON.stringify(out)).not.toMatch(/a@b\.co|Bearer [xy]|eyJabcdefg/);
    // Input is not mutated (Sentry may still hold a reference to it).
    expect(event.user.email).toBe("a@b.co");
  });

  it("is depth-limited and leaves non-string primitives alone", () => {
    type Nested = { n?: Nested; v: number };
    let deep: Nested = { v: 1 };
    for (let i = 0; i < 20; i++) deep = { n: deep, v: i };
    expect(() => scrubEvent({ extra: { deep, ok: true, count: 3, nil: null } } as never)).not.toThrow();
  });
});
