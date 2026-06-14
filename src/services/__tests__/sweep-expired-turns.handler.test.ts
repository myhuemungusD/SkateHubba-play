/**
 * Server-layer tests for the auto-referee cron handler
 * (`api/cron/sweep-expired-turns.ts`).
 *
 * These guard the operational invariants that a future edit could silently
 * break: fail-closed auth, "no DB touch on auth failure", and dry-run never
 * writing. firebase-admin is fully mocked — no real network, no real Firestore.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── firebase-admin mocks ───────────────────────────────────────────────────
// Hoisted spies so the `vi.mock` factories (hoisted to top-of-file) can
// reference them and the test body can assert on init / Firestore access.
const h = vi.hoisted(() => ({
  getAppsMock: vi.fn(),
  initializeAppMock: vi.fn(),
  certMock: vi.fn((sa: unknown) => ({ __cert: sa })),
  getFirestoreMock: vi.fn(),
  serverTimestampSentinel: { __srv: true },
  arrayUnionMock: vi.fn((v: unknown) => ({ __arrayUnion: v })),
}));
const { getAppsMock, initializeAppMock, getFirestoreMock } = h;

vi.mock("firebase-admin/app", () => ({
  getApps: h.getAppsMock,
  initializeApp: h.initializeAppMock,
  cert: h.certMock,
}));

// Minimal stand-ins for the admin SDK value objects used by the handler.
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: h.getFirestoreMock,
  FieldValue: {
    serverTimestamp: () => h.serverTimestampSentinel,
    arrayUnion: h.arrayUnionMock,
  },
  Timestamp: {
    fromMillis: (ms: number) => ({ __ts: ms, toMillis: () => ms }),
  },
}));

import handler from "../../../api/cron/sweep-expired-turns";
import { makeGameDoc, makeDeadline } from "./turnForfeit.test-helpers";

/** A response double that records the status code and JSON body. */
function makeRes() {
  const out: { code?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      out.code = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
    },
  };
  return { res, out };
}

interface ReqOpts {
  authorization?: string;
  query?: Record<string, string | string[] | undefined>;
  url?: string;
}
function makeReq(opts: ReqOpts = {}) {
  const headers: Record<string, string | string[] | undefined> = {};
  if (opts.authorization !== undefined) headers.authorization = opts.authorization;
  return { method: "GET", headers, query: opts.query, url: opts.url };
}

const VALID_SA = JSON.stringify({
  project_id: "demo",
  client_email: "svc@demo.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
  delete process.env.DRY_RUN;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.DRY_RUN;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
});

describe("sweep handler auth (fail-closed)", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    process.env.CRON_SECRET = "s3cret";
    const { res, out } = makeRes();
    await handler(makeReq(), res);
    expect(out.code).toBe(401);
    expect(out.body).toEqual({ error: "unauthorized" });
    // No DB init or access on auth failure.
    expect(getAppsMock).not.toHaveBeenCalled();
    expect(getFirestoreMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the bearer token is wrong", async () => {
    process.env.CRON_SECRET = "s3cret";
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer wrong" }), res);
    expect(out.code).toBe(401);
    expect(getFirestoreMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the token differs only in length (timingSafeEqual guard)", async () => {
    process.env.CRON_SECRET = "s3cret";
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cre" }), res);
    expect(out.code).toBe(401);
    expect(getFirestoreMock).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is unset, even with a Bearer header", async () => {
    // Fail-closed: no secret configured means nothing is authorized.
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer anything" }), res);
    expect(out.code).toBe(401);
    expect(getFirestoreMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the Authorization header is present but empty", async () => {
    process.env.CRON_SECRET = "s3cret";
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "" }), res);
    expect(out.code).toBe(401);
    expect(getFirestoreMock).not.toHaveBeenCalled();
  });

  it("proceeds past auth with the correct token", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = VALID_SA;
    getAppsMock.mockReturnValue([]);
    initializeAppMock.mockReturnValue({ name: "app" });
    // No candidate games → handler returns a clean 200 summary, no writes.
    const db = {
      collection: vi.fn(() => ({
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ docs: [] }),
      })),
      runTransaction: vi.fn(),
    };
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.code).toBe(200);
    expect(getFirestoreMock).toHaveBeenCalledTimes(1);
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(out.body).toMatchObject({ scanned: 0, forfeited: 0, dryRun: false });
  });
});

/** Build an expired, active game doc + a tx whose get() returns it. */
function expiredGameSnapshot() {
  // Reuse the shared forfeit fixture (already expired, active, p1's turn) so the
  // handler test and the decision/parity tests agree on the game shape. The
  // handler reads it back through `toGameDoc`, which spreads the raw data.
  const { id: _id, ...data } = makeGameDoc({ turnDeadline: makeDeadline(Date.now() - 60_000) });
  return { exists: true, id: "g1", data: () => data };
}

/** A db double whose candidate query yields one expired game. */
function dbWithOneExpiredGame() {
  const txUpdate = vi.fn();
  const txSet = vi.fn();
  const txGet = vi.fn().mockResolvedValue(expiredGameSnapshot());
  const docRef = { __doc: true };
  const db = {
    collection: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ docs: [{ id: "g1" }] }),
      doc: vi.fn(() => docRef),
    })),
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ get: txGet, update: txUpdate, set: txSet }),
    ),
  };
  return { db, txUpdate, txSet };
}

describe("sweep handler dry-run (never writes)", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = VALID_SA;
    getAppsMock.mockReturnValue([]);
    initializeAppMock.mockReturnValue({ name: "app" });
  });

  it("counts the forfeit but writes nothing when ?dryRun=1", async () => {
    const { db, txUpdate, txSet } = dbWithOneExpiredGame();
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret", query: { dryRun: "1" } }), res);

    expect(out.code).toBe(200);
    expect(out.body).toMatchObject({ scanned: 1, forfeited: 1, dryRun: true });
    expect(txUpdate).not.toHaveBeenCalled();
    expect(txSet).not.toHaveBeenCalled();
  });

  it("treats DRY_RUN=1 env as dry-run too (no writes)", async () => {
    process.env.DRY_RUN = "1";
    const { db, txUpdate } = dbWithOneExpiredGame();
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.body).toMatchObject({ dryRun: true, forfeited: 1 });
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it("writes the forfeit transition when not a dry-run", async () => {
    const { db, txUpdate } = dbWithOneExpiredGame();
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.body).toMatchObject({ scanned: 1, forfeited: 1, dryRun: false });
    expect(txUpdate).toHaveBeenCalledTimes(1);
    const write = txUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(write.status).toBe("forfeit");
    expect(write.winner).toBe("p2");
  });
});
