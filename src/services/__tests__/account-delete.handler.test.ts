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
  getFirestoreMock: vi.fn(),
  getStorageMock: vi.fn(),
  cascadeMock: vi.fn(),
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

import { VALID_SERVICE_ACCOUNT } from "./cron.test-helpers";
import {
  makeAccountReq,
  makeAccountRes,
  type AccountRequestOpts,
  type AccountResponseCapture,
} from "./account-delete.test-helpers";

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
  // No pre-existing app: the default path is a cold start that initializes one.
  h.getAppsMock.mockReturnValue([]);
  h.initializeAppMock.mockReturnValue(APP);
  h.getAuthMock.mockReturnValue({ verifyIdToken: h.verifyIdTokenMock, deleteUser: h.deleteUserMock });
  h.verifyIdTokenMock.mockResolvedValue({ uid: TOKEN_UID, auth_time: NOW_S });
  h.deleteUserMock.mockResolvedValue(undefined);
  h.getFirestoreMock.mockReturnValue(DB);
  h.getStorageMock.mockReturnValue(STORAGE);
  h.cascadeMock.mockResolvedValue(SUMMARY);
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
