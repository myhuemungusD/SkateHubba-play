/**
 * Server-layer tests for the account-deletion endpoint (`api/account/delete.ts`).
 *
 * This handler destroys data with admin credentials, so its auth check is the
 * only thing between a caller and irreversible erasure. These tests guard the
 * five properties that make it safe:
 *
 *   1. Fail-closed auth — no token, no boot, no erasure.
 *   2. Revocation is actually checked (`verifyIdToken(token, true)`).
 *   3. A stale sign-in cannot delete an account, so a leaked ID token is not
 *      enough on its own.
 *   4. Identity comes ONLY from the verified token — a uid on the wire is
 *      ignored, so the endpoint cannot be aimed at someone else.
 *   5. Data is erased BEFORE the Auth user is deleted, and a failed erasure
 *      leaves the account alive. That ordering is the entire point of moving
 *      deletion server-side; the old client flow deleted Auth first and
 *      orphaned 100% of the user's data.
 *
 * firebase-admin and the erasure cascade are both mocked — no real network,
 * and the cascade's own behaviour is covered by `account-delete.cascade.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── firebase-admin + cascade mocks ─────────────────────────────────────────
const h = vi.hoisted(() => ({
  getAppsMock: vi.fn(),
  initializeAppMock: vi.fn(),
  certMock: vi.fn((sa: unknown) => ({ __cert: sa })),
  getAuthMock: vi.fn(),
  verifyIdTokenMock: vi.fn(),
  deleteUserMock: vi.fn(),
  revokeMock: vi.fn(),
  getFirestoreMock: vi.fn(),
  getStorageMock: vi.fn(),
  cascadeMock: vi.fn(),
  posthogMock: vi.fn(),
}));

vi.mock("firebase-admin/app", () => ({
  getApps: h.getAppsMock,
  initializeApp: h.initializeAppMock,
  cert: h.certMock,
}));

vi.mock("firebase-admin/auth", () => ({ getAuth: h.getAuthMock }));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: h.getFirestoreMock }));
vi.mock("firebase-admin/storage", () => ({ getStorage: h.getStorageMock }));
vi.mock("../../../api/account/_deleteUserData.js", () => ({ deleteUserDataAsAdmin: h.cascadeMock }));
vi.mock("../../../api/account/_posthogErasure.js", () => ({ erasePosthogPerson: h.posthogMock }));
// Only loaded when SENTRY_DSN is set (see the "error reporting" block).
vi.mock("@sentry/node", async () => (await import("./sentry-node.test-helpers")).sentryNodeMock);

import { VALID_SERVICE_ACCOUNT } from "./cron.test-helpers";
import {
  makeAccountReq,
  makeAccountRes,
  type AccountRequestOpts,
  type AccountResponseCapture,
} from "./account-delete.test-helpers";
import { hashIdentity, hashUid } from "../../utils/pii";
import { recordSentryOrder, resetSentryNodeMock, sentryNodeMock, TEST_SENTRY_DSN } from "./sentry-node.test-helpers";

const TOKEN = "eyJhbGciOi.PAYLOAD.SIGNATURE";
const AUTH = `Bearer ${TOKEN}`;
/** The uid inside the verified token — the only identity the handler may use. */
const TOKEN_UID = "uid-of-caller";
/** The uid an attacker puts on the wire. Must never be touched. */
const WIRE_UID = "uid-of-victim";
const APP = { __app: "fresh" };
const DB = { __db: true };
const STORAGE = { __storage: true };

/** Frozen clock so the 5-minute recency boundary can be asserted exactly. */
const NOW_MS = Date.UTC(2026, 7, 9, 12, 0, 0);
const NOW_S = Math.floor(NOW_MS / 1000);
const WINDOW_S = 5 * 60;

const SUMMARY = {
  games: 2,
  gameVideoObjects: 3,
  clips: 1,
  clipThreadComments: 0,
  clipVotes: 4,
  disputes: 0,
  disputeVotes: 2,
  notifications: 7,
  pushTargets: 1,
  achievements: 5,
  avatarObjects: 1,
  usernameReleased: true,
};

let warnSpy: ReturnType<typeof vi.spyOn>;

/**
 * Import a pristine copy of the handler.
 *
 * The module caches its admin app and bucket name across warm invocations, so
 * a shared instance would let one test's successful boot mask another's
 * misconfiguration. Every call gets its own module instance instead.
 */
async function loadHandler() {
  vi.resetModules();
  return (await import("../../../api/account/delete")).default;
}

/**
 * Drive one request. Defaults to a well-formed authorized POST; every test
 * overrides exactly the one field it is about.
 */
async function call(opts: AccountRequestOpts = {}, withEnd = true) {
  const handler = await loadHandler();
  const { res, out } = makeAccountRes(withEnd);
  await handler(makeAccountReq({ method: "POST", authorization: AUTH, ...opts }), res);
  return out;
}

/** Assert nothing destructive ran and the failure body carries `code`. */
function expectRefused(out: AccountResponseCapture, status: number, code: string): void {
  expect(out.code).toBe(status);
  expect(out.body).toEqual({ ok: false, code, message: expect.any(String) });
  expect(h.cascadeMock).not.toHaveBeenCalled();
  expect(h.deleteUserMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = VALID_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_STORAGE_BUCKET;
  delete process.env.ACCOUNT_DELETE_ALLOWED_ORIGIN;
  delete process.env.SENTRY_DSN;
  // No pre-existing app: the default path is a cold start that initializes one.
  h.getAppsMock.mockReturnValue([]);
  h.initializeAppMock.mockReturnValue(APP);
  h.getAuthMock.mockReturnValue({
    verifyIdToken: h.verifyIdTokenMock,
    deleteUser: h.deleteUserMock,
    revokeRefreshTokens: h.revokeMock,
  });
  h.verifyIdTokenMock.mockResolvedValue({ uid: TOKEN_UID, auth_time: NOW_S });
  h.deleteUserMock.mockResolvedValue(undefined);
  h.getFirestoreMock.mockReturnValue(DB);
  h.getStorageMock.mockReturnValue(STORAGE);
  h.cascadeMock.mockResolvedValue(SUMMARY);
  h.posthogMock.mockResolvedValue({ status: "skipped", reason: "not_configured" });
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.useRealTimers();
  vi.resetModules();
});

describe("method guard", () => {
  it.each(["GET", "PUT", "PATCH", "DELETE", "HEAD"])("refuses %s with 405", async (method) => {
    const out = await call({ method });
    expectRefused(out, 405, "method_not_allowed");
    // The verb guard runs first, so a wrong verb can never reach admin credentials.
    expect(h.getAppsMock).not.toHaveBeenCalled();
    expect(h.verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it("refuses a request with no method at all", async () => {
    const out = await call({ method: undefined });
    expectRefused(out, 405, "method_not_allowed");
  });

  it("accepts a lowercase verb from a proxy that rewrote it", async () => {
    const out = await call({ method: "post" });
    expect(out.code).toBe(200);
  });
});

describe("bearer token extraction", () => {
  const MALFORMED: [string, string | string[] | undefined][] = [
    ["absent", undefined],
    ["empty", ""],
    ["whitespace only", "   "],
    ["a bare token with no scheme", TOKEN],
    ["the wrong scheme", `Basic ${TOKEN}`],
    ["a scheme that merely starts with Bearer", `BearerToken ${TOKEN}`],
    ["the scheme with no value", "Bearer"],
    ["the scheme with a blank value", "Bearer    "],
    ["an array of empty values", [""]],
  ];

  it.each(MALFORMED)("401 missing_token when the header is %s", async (_label, authorization) => {
    const out = await call({ authorization });
    expectRefused(out, 401, "missing_token");
    expect(h.verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it("does not boot admin when the token is missing — fail closed before credentials", async () => {
    // A missing service account must not turn a missing token into init_failed:
    // the caller learns nothing about server configuration.
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const out = await call({ authorization: undefined });
    expectRefused(out, 401, "missing_token");
    expect(h.getAppsMock).not.toHaveBeenCalled();
  });

  const ACCEPTED: [string, string | string[]][] = [
    ["lowercase header name", AUTH],
    ["surrounding whitespace", `  ${AUTH}  `],
    ["a lowercase scheme", `bearer ${TOKEN}`],
    ["multiple spaces after the scheme", `Bearer   ${TOKEN}`],
    ["an array header from a proxy", [AUTH, "Bearer other"]],
  ];

  it.each(ACCEPTED)("accepts %s and verifies the token value", async (_label, authorization) => {
    const out = await call({ authorization });
    expect(out.code).toBe(200);
    expect(h.verifyIdTokenMock).toHaveBeenCalledWith(TOKEN, true);
  });

  it("reads a capitalized Authorization header", async () => {
    const out = await call({ headerName: "Authorization" });
    expect(out.code).toBe(200);
    expect(h.verifyIdTokenMock).toHaveBeenCalledWith(TOKEN, true);
  });
});

describe("token verification", () => {
  it("checks revocation — a token minted before a session revoke must not erase", async () => {
    await call();
    expect(h.verifyIdTokenMock).toHaveBeenCalledTimes(1);
    const [passedToken, checkRevoked] = h.verifyIdTokenMock.mock.calls[0];
    expect(passedToken).toBe(TOKEN);
    // Strictly `true`, not merely truthy: firebase-admin treats anything else
    // as "skip the revocation lookup".
    expect(checkRevoked).toBe(true);
  });

  const REJECTIONS: [string, unknown][] = [
    ["expired", Object.assign(new Error("Firebase ID token has expired."), { code: "auth/id-token-expired" })],
    ["revoked", Object.assign(new Error("Firebase ID token has been revoked."), { code: "auth/id-token-revoked" })],
    ["malformed", new Error("Decoding Firebase ID token failed.")],
    ["from another project", new Error("Firebase ID token has incorrect audience.")],
    ["a non-Error rejection", "token verification exploded"],
  ];

  it.each(REJECTIONS)("401 invalid_token when the token is %s", async (_label, rejection) => {
    h.verifyIdTokenMock.mockRejectedValueOnce(rejection);
    const out = await call();
    expectRefused(out, 401, "invalid_token");
  });

  it("returns byte-identical bodies for every rejection reason — no oracle", async () => {
    // Distinguishing expired from revoked from malformed would tell an attacker
    // which of those a captured token is, and whether the uid even exists.
    const bodies: string[] = [];
    for (const [, rejection] of REJECTIONS) {
      h.verifyIdTokenMock.mockRejectedValueOnce(rejection);
      const out = await call();
      bodies.push(JSON.stringify(out.body));
    }
    expect(new Set(bodies).size).toBe(1);
    // The one fixed message is allowed to say "expired" — it says it for every
    // reason, which is the point. Nothing reason-specific may appear.
    expect(bodies[0]).not.toMatch(/revoked|malformed|audience|exploded|project/i);
  });

  it("never writes the ID token into the logs, but keeps the uid", async () => {
    // A deletion audit trail must not itself become a store of the credential
    // that authorized it. The uid is deliberately retained — without it the log
    // cannot evidence an erasure request.
    h.verifyIdTokenMock.mockRejectedValueOnce(new Error("Firebase ID token has expired."));
    await call();
    await call();
    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).not.toContain(TOKEN);
    expect(logged).toContain(TOKEN_UID);
  });
});

describe("recent-login requirement", () => {
  const STALE: [string, unknown][] = [
    ["one second past the window", NOW_S - (WINDOW_S + 1)],
    ["an hour old", NOW_S - 3600],
    ["missing", undefined],
    ["zero", 0],
    ["a string", String(NOW_S)],
    ["null", null],
  ];

  it.each(STALE)("401 requires_recent_login when auth_time is %s", async (_label, auth_time) => {
    h.verifyIdTokenMock.mockResolvedValueOnce({ uid: TOKEN_UID, auth_time });
    const out = await call();
    expectRefused(out, 401, "requires_recent_login");
  });

  const FRESH: [string, number][] = [
    ["right now", NOW_S],
    ["one second ago", NOW_S - 1],
    ["exactly at the window boundary", NOW_S - WINDOW_S],
  ];

  it.each(FRESH)("proceeds when auth_time is %s", async (_label, auth_time) => {
    h.verifyIdTokenMock.mockResolvedValueOnce({ uid: TOKEN_UID, auth_time });
    const out = await call();
    expect(out.code).toBe(200);
    expect(h.cascadeMock).toHaveBeenCalledTimes(1);
  });
});

describe("identity comes only from the token", () => {
  it("ignores a uid supplied in the body and query", async () => {
    const out = await call({ body: { uid: WIRE_UID, username: "victim" }, query: { uid: WIRE_UID } });

    expect(out.code).toBe(200);
    expect(h.cascadeMock).toHaveBeenCalledWith(expect.anything(), TOKEN_UID);
    expect(h.deleteUserMock).toHaveBeenCalledWith(TOKEN_UID);
    const touched = JSON.stringify([h.cascadeMock.mock.calls, h.deleteUserMock.mock.calls]);
    expect(touched).not.toContain(WIRE_UID);
  });

  it("erases whichever uid the verified token carries", async () => {
    h.verifyIdTokenMock.mockResolvedValueOnce({ uid: "another-real-user", auth_time: NOW_S });
    await call({ body: { uid: WIRE_UID } });
    expect(h.cascadeMock).toHaveBeenCalledWith(expect.anything(), "another-real-user");
  });
});

describe("admin bootstrap", () => {
  const BAD_ENV: [string, string | undefined][] = [
    ["unset", undefined],
    ["missing required fields", JSON.stringify({ project_id: "demo" })],
    ["not JSON at all", "not-json"],
  ];

  it.each(BAD_ENV)("500 init_failed when the service account is %s", async (_label, value) => {
    if (value === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = value;
    const out = await call();
    // Reported as a server misconfiguration, never as a token problem — the
    // user must not be told to re-authenticate over an ops failure.
    expectRefused(out, 500, "init_failed");
    expect(h.verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it("passes the named database and derived bucket to the cascade", async () => {
    await call();
    expect(h.getFirestoreMock).toHaveBeenCalledWith(APP, "skatehubba");
    expect(h.cascadeMock).toHaveBeenCalledWith(
      { db: DB, storage: STORAGE, bucketName: "demo.firebasestorage.app" },
      TOKEN_UID,
    );
    expect(h.initializeAppMock).toHaveBeenCalledWith(
      expect.objectContaining({ storageBucket: "demo.firebasestorage.app" }),
    );
  });

  it("honours FIREBASE_STORAGE_BUCKET for a legacy .appspot.com bucket", async () => {
    // Without the override the cascade would list an empty bucket and report
    // success while the videos survived.
    process.env.FIREBASE_STORAGE_BUCKET = "demo.appspot.com";
    await call();
    expect(h.cascadeMock).toHaveBeenCalledWith(expect.objectContaining({ bucketName: "demo.appspot.com" }), TOKEN_UID);
  });

  it("reuses an already-initialized app instead of double-initializing", async () => {
    const existing = { __app: "warm", options: {} };
    h.getAppsMock.mockReturnValue([existing]);
    process.env.FIREBASE_STORAGE_BUCKET = "demo.appspot.com";
    const out = await call();
    expect(h.initializeAppMock).not.toHaveBeenCalled();
    expect(h.getFirestoreMock).toHaveBeenCalledWith(existing, "skatehubba");
    expect(out.code).toBe(200);
  });

  it("takes the bucket from a warm app's own options when no env override is set", async () => {
    h.getAppsMock.mockReturnValue([{ __app: "warm", options: { storageBucket: "warm-bucket.appspot.com" } }]);
    await call();
    expect(h.cascadeMock).toHaveBeenCalledWith(
      expect.objectContaining({ bucketName: "warm-bucket.appspot.com" }),
      TOKEN_UID,
    );
  });

  it("refuses to erase when no bucket name can be resolved", async () => {
    // A warm app initialized elsewhere (the crons initialize without a
    // storageBucket) plus no env override. Erasing with an empty bucket would
    // list nothing, so the Firestore rows would vanish while every video and
    // avatar quietly survived — silent data retention, the exact failure this
    // endpoint exists to prevent. It must fail loudly instead.
    h.getAppsMock.mockReturnValue([{ __app: "warm", options: {} }]);
    const out = await call();
    expectRefused(out, 500, "init_failed");
  });
});

describe("CORS", () => {
  // Same-origin on the web; cross-origin on native, where the Capacitor webview
  // serves the app from a custom scheme. Without a preflight answer the native
  // delete-account flow cannot run at all — and the App Store requires it.
  const ALLOWED = [
    "https://skatehubba.com",
    "https://www.skatehubba.com",
    "capacitor://localhost",
    "https://localhost",
  ];

  it.each(ALLOWED)("echoes the allowlisted origin %s", async (origin) => {
    const out = await call({ origin });
    expect(out.headers["Access-Control-Allow-Origin"]).toBe(origin);
    expect(out.headers["Access-Control-Allow-Headers"]).toBe("Authorization");
    expect(out.headers["Vary"]).toBe("Origin");
  });

  it.each(["https://evil.example", "null", "https://skatehubba.com.evil.example"])(
    "does not echo the unlisted origin %s",
    async (origin) => {
      const out = await call({ origin });
      expect(out.headers["Access-Control-Allow-Origin"]).toBeUndefined();
      // Vary must be set regardless, or a cache could hand one origin's
      // response — including its Allow-Origin — to another.
      expect(out.headers["Vary"]).toBe("Origin");
    },
  );

  it("adds the configured extra origin", async () => {
    process.env.ACCOUNT_DELETE_ALLOWED_ORIGIN = "https://preview.example";
    const out = await call({ origin: "https://preview.example" });
    expect(out.headers["Access-Control-Allow-Origin"]).toBe("https://preview.example");
  });

  it("reads a capitalized Origin header and an array value", async () => {
    const capitalized = await call({ origin: "https://skatehubba.com", originHeaderName: "Origin" });
    expect(capitalized.headers["Access-Control-Allow-Origin"]).toBe("https://skatehubba.com");
    const array = await call({ origin: ["capacitor://localhost", "https://evil.example"] });
    expect(array.headers["Access-Control-Allow-Origin"]).toBe("capacitor://localhost");
  });

  it("answers a preflight with 204 and no auth work", async () => {
    // A preflight carries no Authorization header by design, so requiring one
    // would break every cross-origin call before it started.
    const out = await call({ method: "OPTIONS", authorization: undefined, origin: "capacitor://localhost" });
    expect(out.code).toBe(204);
    expect(out.ended).toBe(true);
    expect(out.headers["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
    expect(h.getAppsMock).not.toHaveBeenCalled();
    expect(h.cascadeMock).not.toHaveBeenCalled();
  });

  it("ends a preflight with a null body when the platform response has no end()", async () => {
    const out = await call({ method: "OPTIONS", authorization: undefined }, false);
    expect(out.code).toBe(204);
    expect(out.body).toBeNull();
  });

  it("sets Vary on a refusal too", async () => {
    const out = await call({ method: "GET", origin: "https://skatehubba.com" });
    expect(out.code).toBe(405);
    expect(out.headers["Vary"]).toBe("Origin");
  });
});

describe("erasure ordering", () => {
  it("does NOT delete the Auth user when erasure fails", async () => {
    // The whole point of this endpoint. Auth-first was the old bug: it signed
    // the client out and stranded 100% of the user's data with nothing left
    // able to authorize its removal.
    h.cascadeMock.mockRejectedValueOnce(new Error("firestore unavailable"));
    const out = await call();

    expect(out.code).toBe(500);
    expect(out.body).toEqual({ ok: false, code: "erasure_failed", message: expect.any(String) });
    expect(h.deleteUserMock).not.toHaveBeenCalled();
  });

  it("does not leak the underlying erasure error to the caller", async () => {
    h.cascadeMock.mockRejectedValueOnce(new Error("bucket demo.firebasestorage.app: 403 from svc@demo"));
    const out = await call();
    expect(JSON.stringify(out.body)).not.toContain("403");
  });

  it("erases the data first and deletes the Auth user second", async () => {
    const out = await call();

    expect(out.code).toBe(200);
    expect(out.body).toEqual({ ok: true, authDeleted: true, summary: SUMMARY });
    expect(h.cascadeMock).toHaveBeenCalledTimes(1);
    expect(h.deleteUserMock).toHaveBeenCalledTimes(1);
    expect(h.cascadeMock.mock.invocationCallOrder[0]).toBeLessThan(h.deleteUserMock.mock.invocationCallOrder[0]);
  });

  it("reports success with authDeleted:false when only the Auth delete fails", async () => {
    // The data is already gone, so this is not a failure the user can act on:
    // the client signs out and a retry mops up the Auth record.
    h.deleteUserMock.mockRejectedValueOnce(new Error("USER_NOT_FOUND"));
    const out = await call();

    expect(out.code).toBe(200);
    expect(out.body).toEqual({ ok: true, authDeleted: false, summary: SUMMARY });
  });

  it("never throws to the platform when everything fails at once", async () => {
    // A thrown error becomes an opaque platform 500 with no machine-readable
    // code, and the client branches on the code.
    h.cascadeMock.mockRejectedValueOnce("not-an-error");
    const handler = await loadHandler();
    const { res, out } = makeAccountRes();
    await expect(handler(makeAccountReq({ authorization: AUTH }), res)).resolves.toBeUndefined();
    expect(out.body).toMatchObject({ code: "erasure_failed" });
  });
});

describe("error reporting (server-side Sentry)", () => {
  async function callRecordingOrder(): Promise<{ out: AccountResponseCapture; order: string[] }> {
    const handler = await loadHandler();
    const { res, out } = makeAccountRes();
    const order = recordSentryOrder(res);
    await handler(makeAccountReq({ method: "POST", authorization: AUTH }), res);
    return { out, order };
  }
  const captures = () => sentryNodeMock.captureException.mock.calls;
  /** The first console.warn JSON line whose text contains `fragment`. */
  const loggedLine = (fragment: string): string | undefined =>
    (warnSpy.mock.calls as unknown[][]).map((c) => String(c[0])).find((l) => l.includes(fragment));

  beforeEach(() => {
    process.env.SENTRY_DSN = TEST_SENTRY_DSN;
    resetSentryNodeMock();
  });

  it("is inert without a DSN — the SDK is never initialised", async () => {
    delete process.env.SENTRY_DSN;
    h.cascadeMock.mockRejectedValueOnce(new Error("firestore unavailable"));
    const out = await call();
    expect(out.body).toMatchObject({ code: "erasure_failed" });
    expect(sentryNodeMock.init).not.toHaveBeenCalled();
    expect(captures()).toHaveLength(0);
  });

  it("reports account_delete_erasure_failed with the uid and flushes BEFORE responding", async () => {
    h.cascadeMock.mockRejectedValueOnce(new Error("firestore unavailable"));
    const { out, order } = await callRecordingOrder();
    expect(out.body).toMatchObject({ code: "erasure_failed" });
    expect(order.slice(-3)).toEqual(["error:account_delete_erasure_failed", "flush", "respond"]);
    const ctx = captures().find((c) => c[1].tags.event === "account_delete_erasure_failed")?.[1];
    expect(ctx).toMatchObject({ level: "error", extra: { uidHash: hashUid(TOKEN_UID) } });
    expect(JSON.stringify(captures())).not.toContain(TOKEN_UID);
  });

  it("never sends the ID token to Sentry", async () => {
    h.cascadeMock.mockRejectedValueOnce(new Error("firestore unavailable"));
    await callRecordingOrder();
    expect(JSON.stringify(captures())).not.toContain(TOKEN);
  });

  it("redacts the init failure message (it can quote the service-account secret)", async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"private_key": "-----BEGIN PRIVATE KEY-----SECRET';
    const { out, order } = await callRecordingOrder();
    expect(out.body).toMatchObject({ code: "init_failed" });
    expect(order).toEqual(["error:account_delete_init_failed", "flush", "respond"]);
    const reported = captures()[0][0] as Error;
    expect(`${reported.message} ${reported.stack}`).not.toContain("SECRET");
  });

  it("reports an Auth-delete failure after erasure, flushed before the 200", async () => {
    h.deleteUserMock.mockRejectedValueOnce(new Error("USER_NOT_FOUND"));
    const { out, order } = await callRecordingOrder();
    expect(out.body).toMatchObject({ ok: true, authDeleted: false });
    expect(order.slice(-3)).toEqual(["error:account_delete_auth_failed", "flush", "respond"]);
  });

  it("reports a PostHog failure as a warning with the hash only, and still deletes", async () => {
    h.posthogMock.mockResolvedValueOnce({ status: "failed", reason: "http_503" });
    const { out, order } = await callRecordingOrder();
    expect(out.body).toEqual({ ok: true, authDeleted: true, summary: SUMMARY });
    expect(order).toEqual(["warning:account_delete_posthog_failed", "flush", "respond"]);
    const ctx = captures().find((c) => c[1].tags.event === "account_delete_posthog_failed")?.[1];
    expect(ctx).toMatchObject({
      level: "warning",
      extra: { uidHash: hashUid(TOKEN_UID), distinctId: hashIdentity(TOKEN_UID) },
    });
    expect(JSON.stringify(captures())).not.toContain(TOKEN_UID);
    expect(loggedLine("posthog_failed")).not.toContain(TOKEN_UID);
  });

  it("logs a queued PostHog deletion after erasure and before the Auth delete", async () => {
    const seq: string[] = [];
    h.cascadeMock.mockImplementationOnce(async () => (seq.push("cascade"), SUMMARY));
    h.posthogMock.mockImplementationOnce(async () => (seq.push("posthog"), { status: "queued", personsFound: 1 }));
    h.deleteUserMock.mockImplementationOnce(async () => void seq.push("auth"));
    await call();
    expect(seq).toEqual(["cascade", "posthog", "auth"]);
    expect(h.posthogMock).toHaveBeenCalledWith(TOKEN_UID);
    const line = loggedLine("posthog_queued");
    expect(JSON.parse(line ?? "{}")).toEqual({
      event: "account_delete_posthog_queued",
      uidHash: hashUid(TOKEN_UID),
      personsFound: 1,
    });
    expect(captures()).toHaveLength(0);
  });

  it("logs a skipped PostHog deletion when it is not configured, without a Sentry event", async () => {
    await call();
    const line = loggedLine("posthog_skipped");
    expect(JSON.parse(line ?? "{}")).toMatchObject({ reason: "not_configured", uidHash: hashUid(TOKEN_UID) });
    expect(captures()).toHaveLength(0);
  });

  it("reports a revoke failure as a warning with the hash only, and still erases", async () => {
    h.revokeMock.mockRejectedValueOnce(new Error("auth backend down"));
    const { out, order } = await callRecordingOrder();
    expect(out.body).toEqual({ ok: true, authDeleted: true, summary: SUMMARY });
    expect(order).toEqual(["warning:account_delete_revoke_failed", "flush", "respond"]);
    expect(captures()[0][1]).toMatchObject({ extra: { uidHash: hashUid(TOKEN_UID) } });
    expect(JSON.stringify(captures())).not.toContain(TOKEN_UID);
  });

  it("does not touch PostHog when erasure fails", async () => {
    h.cascadeMock.mockRejectedValueOnce(new Error("firestore unavailable"));
    await call();
    expect(h.posthogMock).not.toHaveBeenCalled();
  });

  it("keeps the success path unchanged when Sentry itself is down", async () => {
    sentryNodeMock.flush.mockRejectedValue(new Error("sentry unreachable"));
    const out = await call();
    expect(out.code).toBe(200);
    expect(out.body).toEqual({ ok: true, authDeleted: true, summary: SUMMARY });
  });
});

describe("?reason=underage (COPPA block before a profile exists)", () => {
  const STALE_S = NOW_S - WINDOW_S - 60;
  /** `profile` answers the three users/{uid} reads in order: pre-check, in-transaction, after deleteUser. */
  function fakeDb(profile: [boolean, boolean?, boolean?] = [false], commit = vi.fn(async () => undefined)) {
    const deleted: string[] = [];
    const reads = [...profile];
    const read = vi.fn(async () => ({ exists: reads.length > 1 ? reads.shift() : reads[0] }));
    const db = {
      doc: (path: string) => ({ path, get: read }),
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const staged: string[] = [];
        const out = await fn({
          get: (ref: { get: typeof read }) => ref.get(),
          delete: (ref: { path: string }) => staged.push(ref.path),
        });
        await commit();
        deleted.push(...staged);
        return out;
      },
    };
    h.getFirestoreMock.mockReturnValue(db);
    return { deleted, read };
  }
  const underage = () => call({ query: { reason: "underage" } });
  /** Everything that left the function: log lines, plus Sentry events with error messages spelled out. */
  const raw = () =>
    JSON.stringify([warnSpy.mock.calls, sentryNodeMock.captureException.mock.calls], (_, v: unknown) =>
      v instanceof Error ? v.message : v,
    );

  /** A 200 underage answer that removed exactly the three pre-profile docs. */
  function expectErased(out: AccountResponseCapture, deleted: string[]): void {
    expect(out.code).toBe(200);
    expect(out.body).toEqual({ ok: true, authDeleted: true, mode: "underage" });
    expect(deleted).toEqual([
      `onlineStatus/${TOKEN_UID}`,
      `users/${TOKEN_UID}/private/profile`,
      `pushTargets/${TOKEN_UID}`,
    ]);
  }

  it("deletes the pre-profile docs, then the Auth user, past the recent-login window, without revoking", async () => {
    h.verifyIdTokenMock.mockResolvedValue({ uid: TOKEN_UID, auth_time: STALE_S });
    const { deleted } = fakeDb();
    const out = await underage();
    expectErased(out, deleted);
    // A revoke would make verifyIdToken(token, true) reject this session for
    // good, so a failure after it could never be retried.
    expect(h.revokeMock).not.toHaveBeenCalled();
    expect(h.deleteUserMock).toHaveBeenCalledWith(TOKEN_UID);
    expect(h.cascadeMock).not.toHaveBeenCalled();
  });

  it("accepts the reason from an array query value", async () => {
    fakeDb();
    const out = await call({ query: { reason: ["underage"] } as unknown as Record<string, string> });
    expect(out.body).toEqual({ ok: true, authDeleted: true, mode: "underage" });
  });

  it.each([
    ["a stale", STALE_S],
    ["a fresh", NOW_S],
  ])("answers 409 has_profile and touches nothing for %s sign-in with a profile", async (_, authTime) => {
    h.verifyIdTokenMock.mockResolvedValue({ uid: TOKEN_UID, auth_time: authTime });
    const { deleted } = fakeDb([true]);
    expectRefused(await underage(), 409, "has_profile");
    expect(deleted).toEqual([]);
    expect(h.revokeMock).not.toHaveBeenCalled();
    expect(h.deleteUserMock).not.toHaveBeenCalled();
    expect(h.cascadeMock).not.toHaveBeenCalled();
  });

  it("answers has_profile when the profile commits before the transaction reads it", async () => {
    const { deleted } = fakeDb([false, true]);
    expectRefused(await underage(), 409, "has_profile");
    expect(deleted).toEqual([]);
    expect(h.deleteUserMock).not.toHaveBeenCalled();
  });

  it("erases a profile that appears after the Auth user is gone", async () => {
    fakeDb([false, false, true]);
    const out = await underage();
    expect(out.body).toEqual({ ok: true, authDeleted: true, mode: "underage" });
    expect(h.cascadeMock).toHaveBeenCalledWith(expect.objectContaining({ db: expect.anything() }), TOKEN_UID);
    expect(h.deleteUserMock.mock.invocationCallOrder[0]).toBeLessThan(h.cascadeMock.mock.invocationCallOrder[0]);
    expect(raw()).toContain("account_delete_underage_raced");
  });

  it("reports erasure_failed and keeps the Auth user when the doc cleanup fails", async () => {
    fakeDb(
      [false],
      vi.fn(async () => Promise.reject(new Error(`unavailable for ${TOKEN_UID}`))),
    );
    const out = await underage();
    expectRefused(out, 500, "erasure_failed");
    expect(h.deleteUserMock).not.toHaveBeenCalled();
  });

  it("lets the same token retry after a failed commit and erase the sign-in", async () => {
    h.verifyIdTokenMock.mockResolvedValue({ uid: TOKEN_UID, auth_time: STALE_S });
    const commit = vi.fn(async () => undefined).mockRejectedValueOnce(new Error("unavailable"));
    const { deleted } = fakeDb([false], commit);
    expectRefused(await underage(), 500, "erasure_failed");
    expect(h.deleteUserMock).not.toHaveBeenCalled();
    const out = await underage();
    expectErased(out, deleted);
    expect(h.deleteUserMock).toHaveBeenCalledTimes(1);
    expect(h.revokeMock).not.toHaveBeenCalled();
  });

  it("reports a failed raced cascade as its own error-level event", async () => {
    process.env.SENTRY_DSN = TEST_SENTRY_DSN;
    resetSentryNodeMock();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fakeDb([false, false, true]);
      h.cascadeMock.mockRejectedValueOnce(new Error(`cascade down for ${TOKEN_UID}`));
      const out = await underage();
      expect(out.code).toBe(500);
      expect(out.body).toMatchObject({ ok: false, code: "erasure_failed" });
      expect(h.deleteUserMock).toHaveBeenCalledWith(TOKEN_UID);
      expect(errorSpy.mock.calls).toEqual([
        [JSON.stringify({ event: "account_delete_underage_raced_cascade_failed", uidHash: hashUid(TOKEN_UID) })],
      ]);
      expect(raw()).not.toContain("account_delete_underage_failed");
      expect(sentryNodeMock.captureException).toHaveBeenCalledTimes(1);
      expect(
        JSON.stringify(sentryNodeMock.captureException.mock.calls, (_, v: unknown) =>
          v instanceof Error ? v.message : v,
        ),
      ).toContain("account_delete_underage_raced_cascade_failed");
      expect(JSON.stringify(errorSpy.mock.calls) + raw()).not.toContain(TOKEN_UID);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("reports a non-Error failure as erasure_failed", async () => {
    fakeDb();
    h.deleteUserMock.mockRejectedValueOnce("boom");
    const out = await underage();
    expect(out.code).toBe(500);
    expect(out.body).toMatchObject({ code: "erasure_failed" });
  });

  it("never logs or reports the raw uid, only its hash", async () => {
    process.env.SENTRY_DSN = TEST_SENTRY_DSN;
    resetSentryNodeMock();
    fakeDb(
      [false],
      vi.fn(async () => Promise.reject(new Error(`unavailable for ${TOKEN_UID}`))),
    );
    await underage();
    fakeDb([true]);
    await underage();
    fakeDb([false, false, true]);
    await underage();
    expect(sentryNodeMock.captureException).toHaveBeenCalledTimes(1);
    expect(raw()).not.toContain(TOKEN_UID);
    expect(raw()).toContain(hashUid(TOKEN_UID));
  });
});
