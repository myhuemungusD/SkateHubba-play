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
import { makeDeadline, makeDisputableGameDoc, makeGameDoc } from "./turnForfeit.test-helpers";

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
function expiredGameSnapshot(overrides: Partial<Parameters<typeof makeGameDoc>[0]> = {}) {
  // Reuse the shared forfeit fixture (already expired, active, p1's turn) so the
  // handler test and the decision/parity tests agree on the game shape. The
  // handler reads it back through `toGameDoc`, which spreads the raw data.
  const { id: _id, ...data } = makeGameDoc({ turnDeadline: makeDeadline(Date.now() - 60_000), ...overrides });
  return { exists: true, id: "g1", data: () => data };
}

/** Snapshot of an expired disputable game (forces the auto-accept branch). */
function disputableSnapshot(overrides: Partial<Parameters<typeof makeGameDoc>[0]> = {}) {
  const { id: _id, ...data } = makeDisputableGameDoc({
    turnDeadline: makeDeadline(Date.now() - 60_000),
    ...overrides,
  });
  return { exists: true, id: "g1", data: () => data };
}

interface SweepDbDoubleOpts {
  /** Override the candidate-game ids returned by the eligibility query. */
  candidateIds?: string[];
  /** Per-id snapshot factory. Defaults to a setting-phase expired fixture. */
  snapshotFor?: (id: string) => ReturnType<typeof expiredGameSnapshot>;
  /** Hook to short-circuit a runTransaction call (per game id). */
  runTransactionImpl?: (
    fn: (tx: {
      get: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
    }) => Promise<unknown>,
  ) => Promise<unknown>;
}

/**
 * A configurable db double. Defaults to "one expired setting-phase game"; pass
 * `candidateIds`/`snapshotFor` to drive multiple games or alternate fixtures
 * (e.g. a disputable game whose forfeit also writes landed-clip docs).
 */
function makeSweepDbDouble(opts: SweepDbDoubleOpts = {}) {
  const candidateIds = opts.candidateIds ?? ["g1"];
  const snapshotFor = opts.snapshotFor ?? (() => expiredGameSnapshot());
  const txUpdate = vi.fn();
  const txSet = vi.fn();
  const docRef = { __doc: true };

  const runTransaction = vi.fn(async (fn) => {
    if (opts.runTransactionImpl) return opts.runTransactionImpl(fn);
    // Each transaction call gets its own get-spy resolving to the fixture for
    // the current sweep iteration; the loop is sequential so a single shared
    // `currentId` is safe.
    const idForThisTx = candidateIds[runTransaction.mock.calls.length - 1] ?? candidateIds[0];
    const txGet = vi.fn().mockResolvedValue(snapshotFor(idForThisTx));
    return fn({ get: txGet, update: txUpdate, set: txSet });
  });

  const db = {
    collection: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ docs: candidateIds.map((id) => ({ id })) }),
      doc: vi.fn(() => docRef),
    })),
    runTransaction,
  };
  return { db, txUpdate, txSet, runTransaction };
}

/** Back-compat helper used by the dry-run tests. */
function dbWithOneExpiredGame() {
  const { db, txUpdate, txSet } = makeSweepDbDouble();
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

  /** Run one expired game through the handler and assert it ran in dry-run mode. */
  async function expectDryRun(req: ReturnType<typeof makeReq>) {
    const { db, txUpdate } = dbWithOneExpiredGame();
    getFirestoreMock.mockReturnValue(db);
    const { res, out } = makeRes();
    await handler(req, res);
    expect(out.body).toMatchObject({ dryRun: true, forfeited: 1 });
    expect(txUpdate).not.toHaveBeenCalled();
  }

  it("treats DRY_RUN=1 env as dry-run too (no writes)", async () => {
    process.env.DRY_RUN = "1";
    await expectDryRun(makeReq({ authorization: "Bearer s3cret" }));
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

  it("treats DRY_RUN=true env (string) as dry-run too", async () => {
    process.env.DRY_RUN = "true";
    await expectDryRun(makeReq({ authorization: "Bearer s3cret" }));
  });

  it("treats ?dryRun=1 embedded in req.url as dry-run when query is not pre-parsed", async () => {
    // The handler's URL-regex fallback covers platforms that hand us a raw
    // `url` without pre-parsing the query string (some serverless adapters do).
    await expectDryRun(makeReq({ authorization: "Bearer s3cret", url: "/api/cron/sweep-expired-turns?dryRun=1" }));
  });
});

/** Convenience for tests that need a fresh module-level `cachedApp`. */
async function importFreshHandler() {
  vi.resetModules();
  const mod = await import("../../../api/cron/sweep-expired-turns");
  return mod.default;
}

describe("sweep handler init failures (500, never writes)", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
  });

  it("returns 500 when FIREBASE_SERVICE_ACCOUNT_JSON is unset", async () => {
    const freshHandler = await importFreshHandler();
    const { res, out } = makeRes();
    await freshHandler(makeReq({ authorization: "Bearer s3cret" }), res);
    expect(out.code).toBe(500);
    expect(out.body).toMatchObject({ error: "init_failed" });
  });

  it("returns 500 when FIREBASE_SERVICE_ACCOUNT_JSON is malformed JSON", async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = "{not-json";
    const freshHandler = await importFreshHandler();
    const { res, out } = makeRes();
    await freshHandler(makeReq({ authorization: "Bearer s3cret" }), res);
    expect(out.code).toBe(500);
    expect(out.body).toMatchObject({ error: "init_failed" });
  });

  it("returns 500 when the service account is missing required fields", async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: "demo" });
    const freshHandler = await importFreshHandler();
    const { res, out } = makeRes();
    await freshHandler(makeReq({ authorization: "Bearer s3cret" }), res);
    expect(out.code).toBe(500);
    expect(out.body).toMatchObject({ error: "init_failed" });
  });
});

describe("sweep handler query/runtime failures", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = VALID_SA;
    getAppsMock.mockReturnValue([]);
    initializeAppMock.mockReturnValue({ name: "app" });
  });

  it("returns 500 with the partial summary when the eligibility query fails", async () => {
    const queryError = new Error("missing-index");
    const db = {
      collection: vi.fn(() => ({
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockRejectedValue(queryError),
      })),
      runTransaction: vi.fn(),
    };
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.code).toBe(500);
    expect(out.body).toMatchObject({ error: "sweep_failed", scanned: 0, forfeited: 0 });
    // A failed eligibility query must never have driven the per-game loop.
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  it("isolates per-game errors: one transaction throws, the sweep still processes the rest", async () => {
    const txError = new Error("contention");
    let call = 0;
    const { db, txUpdate } = makeSweepDbDouble({
      candidateIds: ["bad", "good"],
      runTransactionImpl: async (fn) => {
        call += 1;
        if (call === 1) throw txError;
        const txGet = vi.fn().mockResolvedValue({
          exists: true,
          id: "good",
          data: () => {
            const { id: _id, ...data } = makeGameDoc({ turnDeadline: makeDeadline(Date.now() - 60_000) });
            return data;
          },
        });
        return fn({ get: txGet, update: txUpdate, set: vi.fn() });
      },
    });
    getFirestoreMock.mockReturnValue(db);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.code).toBe(200);
    expect(out.body).toMatchObject({ scanned: 2, errors: 1, forfeited: 1 });
    // Per-game failure logs a structured warn but the handler still returns 200.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("sweep handler disputeAccept branch (writes landed clips)", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = VALID_SA;
    getAppsMock.mockReturnValue([]);
    initializeAppMock.mockReturnValue({ name: "app" });
  });

  it("writes the game transition + both set & match clip docs when both videos are present", async () => {
    const { db, txUpdate, txSet } = makeSweepDbDouble({ snapshotFor: () => disputableSnapshot() });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.code).toBe(200);
    expect(out.body).toMatchObject({ scanned: 1, forfeited: 1, dryRun: false });

    // Game doc update is the disputeAccept transition (no `status=forfeit`).
    expect(txUpdate).toHaveBeenCalledTimes(1);
    const gameWrite = txUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(gameWrite.phase).toBe("setting");
    expect(gameWrite.status).toBeUndefined();

    // Two clip docs are written: set + match. Spot-check each payload's shape
    // matches `writeLandedClipsInTransaction` in src/services/clips.writes.ts.
    expect(txSet).toHaveBeenCalledTimes(2);
    const setPayload = txSet.mock.calls[0][1] as Record<string, unknown>;
    const matchPayload = txSet.mock.calls[1][1] as Record<string, unknown>;
    expect(setPayload).toMatchObject({
      role: "set",
      gameId: "g1",
      playerUid: "p1",
      trickName: "Heelflip",
      videoUrl: "https://vid/set.webm",
      moderationStatus: "active",
      upvoteCount: 0,
    });
    expect(matchPayload).toMatchObject({
      role: "match",
      gameId: "g1",
      playerUid: "p2",
      videoUrl: "https://vid/match.webm",
      moderationStatus: "active",
      upvoteCount: 0,
    });
  });

  it("writes only the set clip when the match video is missing (no orphan match doc)", async () => {
    const { db, txSet } = makeSweepDbDouble({
      snapshotFor: () => disputableSnapshot({ matchVideoUrl: null }),
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.code).toBe(200);
    expect(txSet).toHaveBeenCalledTimes(1);
    const onlyPayload = txSet.mock.calls[0][1] as Record<string, unknown>;
    expect(onlyPayload).toMatchObject({ role: "set" });
  });

  it("writes nothing for a disputable game with no videos at all", async () => {
    const { db, txSet } = makeSweepDbDouble({
      snapshotFor: () => disputableSnapshot({ currentTrickVideoUrl: null, matchVideoUrl: null }),
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.code).toBe(200);
    expect(txSet).not.toHaveBeenCalled();
  });
});

describe("sweep handler idempotency (no-op on already-resolved games)", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = VALID_SA;
    getAppsMock.mockReturnValue([]);
    initializeAppMock.mockReturnValue({ name: "app" });
  });

  it("counts the game as skipped (not forfeited) when its snapshot is already complete", async () => {
    // Eligibility query returns the id; the per-game transactional re-read finds
    // the game already complete — handler must skip without writing.
    const { db, txUpdate, txSet } = makeSweepDbDouble({
      snapshotFor: () => expiredGameSnapshot({ status: "complete" }),
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.code).toBe(200);
    expect(out.body).toMatchObject({ scanned: 1, forfeited: 0, skipped: 1, errors: 0 });
    expect(txUpdate).not.toHaveBeenCalled();
    expect(txSet).not.toHaveBeenCalled();
  });

  it("counts the game as skipped when the snapshot no longer exists (raced into deletion)", async () => {
    const { db, txUpdate } = makeSweepDbDouble({
      runTransactionImpl: async (fn) => {
        const txGet = vi.fn().mockResolvedValue({ exists: false, id: "g1", data: () => ({}) });
        return fn({ get: txGet, update: vi.fn(), set: vi.fn() });
      },
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.body).toMatchObject({ scanned: 1, forfeited: 0, skipped: 1 });
    expect(txUpdate).not.toHaveBeenCalled();
  });
});
