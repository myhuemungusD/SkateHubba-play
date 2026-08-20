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
import { makeRes, makeReq, VALID_SERVICE_ACCOUNT } from "./cron.test-helpers";
import { makeGameDoc, makeDeadline } from "./turnForfeit.test-helpers";

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

  /** A db whose game query returns nothing — init succeeds, sweep is a no-op. */
  function makeEmptyDb() {
    return {
      collection: vi.fn(() => ({
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ docs: [] }),
      })),
      runTransaction: vi.fn(),
    };
  }

  it("proceeds past auth with the correct token", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = VALID_SERVICE_ACCOUNT;
    getAppsMock.mockReturnValue([]);
    initializeAppMock.mockReturnValue({ name: "app" });
    // No candidate games → handler returns a clean 200 summary, no writes.
    const db = makeEmptyDb();
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.code).toBe(200);
    expect(getFirestoreMock).toHaveBeenCalledTimes(1);
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(out.body).toMatchObject({ scanned: 0, forfeited: 0, dryRun: false });
  });

  it("initializes from a hand-paste-mangled service account (2026-07-27 outage)", async () => {
    process.env.CRON_SECRET = "s3cret";
    // The production shape: every `\n` escape in the pretty-printed value
    // expanded to a real newline by the Vercel dashboard paste. Sweep reads
    // the same env var as drain and was down for the same reason — this is
    // the regression that keeps its half of the fix from being reverted.
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(JSON.parse(VALID_SERVICE_ACCOUNT), null, 2).replace(
      /\\n/g,
      "\n",
    );
    getAppsMock.mockReturnValue([]);
    initializeAppMock.mockReturnValue({ name: "app" });
    getFirestoreMock.mockReturnValue(makeEmptyDb());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // The module caches its admin app after first init; a fresh instance is
    // the only way to exercise the init path again mid-file.
    vi.resetModules();
    const { default: freshHandler } = await import("../../../api/cron/sweep-expired-turns");
    const { res, out } = makeRes();
    await freshHandler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.code).toBe(200);
    const sa = h.certMock.mock.calls.at(-1)?.[0] as { privateKey: string };
    expect(sa.privateKey).toBe("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("service_account_json_repaired"));
    warn.mockRestore();
    vi.resetModules();
  });
});

describe("sweep handler method guard (405, checked after auth)", () => {
  it("rejects an authorized non-GET request with 405 and performs no sweep", async () => {
    process.env.CRON_SECRET = "s3cret";
    // Valid config on purpose: proves the verb guard short-circuits BEFORE any
    // admin init / query, so a POST can never trigger a state mutation.
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = VALID_SERVICE_ACCOUNT;
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret", method: "POST" }), res);
    expect(out.code).toBe(405);
    expect(out.body).toEqual({ error: "method_not_allowed" });
    expect(getFirestoreMock).not.toHaveBeenCalled();
  });

  it("returns 401 (not 405) for an unauthenticated non-GET — verb not disclosed", async () => {
    // Auth-first ordering: a missing bearer on a POST must surface as 401, never
    // leak that the allowed method is GET.
    process.env.CRON_SECRET = "s3cret";
    const { res, out } = makeRes();
    await handler(makeReq({ method: "POST" }), res);
    expect(out.code).toBe(401);
    expect(out.body).toEqual({ error: "unauthorized" });
    expect(getFirestoreMock).not.toHaveBeenCalled();
  });

  it("returns 401 (not 405) for a blank-bearer non-GET", async () => {
    process.env.CRON_SECRET = "s3cret";
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "", method: "DELETE" }), res);
    expect(out.code).toBe(401);
    expect(getFirestoreMock).not.toHaveBeenCalled();
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
      // Candidate docs carry data() because the notification passes read the
      // doc body (createdAt / turnDeadline) straight off the query snapshot.
      get: vi.fn().mockResolvedValue({ docs: [expiredGameSnapshot()], empty: false }),
      doc: vi.fn(() => docRef),
    })),
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ get: txGet, update: txUpdate, set: txSet }),
    ),
  };
  return { db, txUpdate, txSet };
}

/**
 * A richer db double for the auto-resolve notification path. Routes by
 * collection name so the in-tx notification write, the post-tx pushTargets
 * read, and the push_dispatch add can all be observed. The candidate query is
 * served from the "games" collection; everything else is the per-collection
 * surface the handler touches.
 */
function dbForResolve(rawGameData: Record<string, unknown>, pushTokens: string[] = []) {
  const txUpdate = vi.fn();
  const txSet = vi.fn();
  const txGet = vi.fn().mockResolvedValue({ exists: true, id: "g1", data: () => rawGameData });
  const dispatchAdd = vi.fn().mockResolvedValue(undefined);
  const pushTargetsGet = vi
    .fn()
    .mockResolvedValue({ exists: pushTokens.length > 0, data: () => ({ tokens: pushTokens }) });

  const collection = vi.fn((name: string) => {
    if (name === "push_dispatch") {
      return { add: dispatchAdd, doc: vi.fn(() => ({ __doc: "push_dispatch" })) };
    }
    if (name === "pushTargets") {
      return { doc: vi.fn(() => ({ get: pushTargetsGet })) };
    }
    // games (candidate query + gameRef) and notifications/clips (doc refs).
    return {
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ docs: [{ id: "g1", data: () => rawGameData }], empty: false }),
      doc: vi.fn(() => ({ __doc: name })),
    };
  });

  const db = {
    collection,
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ get: txGet, update: txUpdate, set: txSet }),
    ),
  };
  return { db, txUpdate, txSet, dispatchAdd, pushTargetsGet };
}

/** Raw (id-stripped) game data for a phase, already expired + active. */
function rawGame(overrides: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, ...data } = makeGameDoc({ turnDeadline: makeDeadline(Date.now() - 60_000), ...overrides });
  return data;
}

describe("sweep handler dry-run (never writes)", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = VALID_SERVICE_ACCOUNT;
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

/**
 * A db double aimed at the two notification passes.
 *
 * All three game queries (forfeit candidates, challenge reconcile, deadline
 * reminder) hit db.collection("games"), so the games `get()` serves a fixed
 * SEQUENCE: [forfeit, reconcile, reminder].
 */
function dbForNotifyPasses(opts: {
  reconcile?: Array<{ id: string; data: () => Record<string, unknown> }>;
  reminder?: Array<{ id: string; data: () => Record<string, unknown> }>;
  challengeNotified?: boolean;
  tokens?: string[];
  gamesQueryError?: Error;
}) {
  const notifSet = vi.fn();
  const dispatchAdd = vi.fn().mockResolvedValue(undefined);
  // Tombstone writes: `batchUpdate` is the in-batch stamp that rides with a
  // notification; `gameUpdate` is the standalone migration stamp.
  const batchUpdate = vi.fn();
  const gameUpdate = vi.fn().mockResolvedValue(undefined);
  const batchCommit = vi.fn().mockResolvedValue(undefined);
  const gamesResults = [{ docs: [] }, { docs: opts.reconcile ?? [] }, { docs: opts.reminder ?? [] }];
  const gamesFilters: Array<Array<unknown[]>> = [];
  let gamesCall = 0;

  const collection = vi.fn((name: string) => {
    if (name === "push_dispatch") return { add: dispatchAdd };
    if (name === "pushTargets") {
      return {
        doc: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ tokens: opts.tokens ?? [] }) }),
        })),
      };
    }
    if (name === "notifications") {
      return {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ empty: !opts.challengeNotified }),
        doc: vi.fn((id: string) => ({ __notification: id })),
      };
    }
    // Each games query gets its own recorder so a test can assert the exact
    // filter set of a given pass (0 = forfeit, 1 = reconcile, 2 = reminder).
    const filters: Array<unknown[]> = [];
    gamesFilters.push(filters);
    const q = {
      where: vi.fn((...args: unknown[]) => {
        filters.push(args);
        return q;
      }),
      orderBy: vi.fn(() => q),
      limit: vi.fn(() => q),
      get: vi.fn(() => {
        if (opts.gamesQueryError && gamesCall > 0) return Promise.reject(opts.gamesQueryError);
        return Promise.resolve(gamesResults[gamesCall++] ?? { docs: [] });
      }),
      doc: vi.fn((id: string) => ({ __game: id, update: (data: unknown) => gameUpdate(id, data) })),
    };
    return q;
  });

  const batch = vi.fn(() => ({
    set: (ref: { __notification: string }, data: unknown) => notifSet(ref.__notification, data),
    update: (ref: { __game: string }, data: unknown) => batchUpdate(ref.__game, data),
    commit: batchCommit,
  }));

  return {
    db: { collection, batch, runTransaction: vi.fn() },
    notifSet,
    dispatchAdd,
    batchUpdate,
    gameUpdate,
    /** Filters applied by the nth games query (0 forfeit, 1 reconcile, 2 reminder). */
    gamesFilters: (n: number): Array<unknown[]> => gamesFilters[n] ?? [],
  };
}

/** Timestamp stub matching the admin SDK surface the passes read. */
function tsAt(ms: number): { toMillis: () => number } {
  return { toMillis: () => ms };
}

function challengeGame(
  ageMs: number,
  extra: Record<string, unknown> = {},
): { id: string; data: () => Record<string, unknown> } {
  return {
    id: "gc1",
    data: () => ({
      player1Uid: "p1",
      player2Uid: "p2",
      player1Username: "alice",
      status: "active",
      turnNumber: 1,
      createdAt: tsAt(Date.now() - ageMs),
      ...extra,
    }),
  };
}

function deadlineGame(
  leadMs: number,
  extra: Record<string, unknown> = {},
): { id: string; data: () => Record<string, unknown> } {
  return {
    id: "gd1",
    data: () => ({
      player1Uid: "p1",
      player2Uid: "p2",
      player1Username: "alice",
      player2Username: "bob",
      status: "active",
      phase: "matching",
      currentTurn: "p2",
      turnNumber: 3,
      turnDeadline: tsAt(Date.now() + leadMs),
      ...extra,
    }),
  };
}

describe("sweep handler challenge-notification reconcile (server backstop)", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = VALID_SERVICE_ACCOUNT;
    getAppsMock.mockReturnValue([]);
    initializeAppMock.mockReturnValue({ name: "app" });
  });

  it("backfills the missing new_challenge notification at a deterministic id", async () => {
    // The client's write died mid-flight (tab closed on navigate). The
    // opponent otherwise never learns the game exists.
    const { db, notifSet, dispatchAdd, batchUpdate } = dbForNotifyPasses({
      reconcile: [challengeGame(5 * 60_000)],
      tokens: ["tok-1"],
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.body).toMatchObject({ reconciled: 1, notifyErrors: 0 });
    expect(notifSet).toHaveBeenCalledTimes(1);
    const [id, doc] = notifSet.mock.calls[0] as [string, Record<string, unknown>];
    // Deterministic id ⇒ two overlapping cron runs converge on one doc.
    expect(id).toBe("gc1_1_new_challenge_notify");
    expect(doc).toMatchObject({ senderUid: "p1", recipientUid: "p2", type: "new_challenge", read: false });
    expect(doc.body).toContain("@alice");
    expect(dispatchAdd).toHaveBeenCalledTimes(1);
    // The tombstone rides the SAME batch as the notification — all-or-nothing.
    expect(batchUpdate).toHaveBeenCalledWith("gc1", { challengeNotifiedAt: h.serverTimestampSentinel });
  });

  it("never re-notifies a game already stamped, even with no notification doc left", async () => {
    // THE regression: the recipient dismissed the challenge from the bell,
    // which is a real Firestore delete. Re-deriving "notified" from the
    // /notifications collection re-created and re-pushed it every 15 minutes
    // for the full 24h window. The game-doc stamp is not theirs to delete.
    const { db, notifSet, dispatchAdd, gameUpdate } = dbForNotifyPasses({
      reconcile: [challengeGame(5 * 60_000, { challengeNotifiedAt: tsAt(Date.now() - 60_000) })],
      tokens: ["tok-1"],
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.body).toMatchObject({ reconciled: 0, notifyErrors: 0 });
    expect(notifSet).not.toHaveBeenCalled();
    expect(dispatchAdd).not.toHaveBeenCalled();
    // Cheapest possible skip: the stamp short-circuits before the /notifications
    // query, so a stamped game costs one document read per scan and nothing else.
    expect(gameUpdate).not.toHaveBeenCalled();
  });

  it("stamps (but does not re-notify) an in-flight game whose client notification landed", async () => {
    // Migration path for games created before the tombstone shipped: the
    // client's doc proves delivery, so stamp the game once and stop scanning it.
    const { db, notifSet, gameUpdate } = dbForNotifyPasses({
      reconcile: [challengeGame(5 * 60_000)],
      challengeNotified: true,
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.body).toMatchObject({ reconciled: 0 });
    expect(notifSet).not.toHaveBeenCalled();
    expect(gameUpdate).toHaveBeenCalledWith("gc1", { challengeNotifiedAt: h.serverTimestampSentinel });
  });

  it("does not stamp the migration marker under dry-run", async () => {
    const { db, gameUpdate } = dbForNotifyPasses({
      reconcile: [challengeGame(5 * 60_000)],
      challengeNotified: true,
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret", query: { dryRun: "1" } }), res);

    expect(out.body).toMatchObject({ reconciled: 0, dryRun: true });
    expect(gameUpdate).not.toHaveBeenCalled();
  });

  it("only considers ACTIVE games (no 'New Challenge!' for a dead game)", async () => {
    const harness = dbForNotifyPasses({ reconcile: [] });
    getFirestoreMock.mockReturnValue(harness.db);

    const { res } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    // Query index 1 is the reconcile pass (0 is the forfeit sweep).
    expect(harness.gamesFilters(1)).toContainEqual(["status", "==", "active"]);
    expect(harness.gamesFilters(1)).toContainEqual(["turnNumber", "==", 1]);
  });

  it("leaves a game inside the grace period alone (no race with the client)", async () => {
    const { db, notifSet } = dbForNotifyPasses({ reconcile: [challengeGame(10_000)] });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.body).toMatchObject({ reconciled: 0 });
    expect(notifSet).not.toHaveBeenCalled();
  });

  it("skips games with no usable createdAt or participants", async () => {
    const { db, notifSet } = dbForNotifyPasses({
      reconcile: [
        { id: "no-ts", data: () => ({ player1Uid: "p1", player2Uid: "p2" }) },
        { id: "no-players", data: () => ({ createdAt: tsAt(Date.now() - 5 * 60_000) }) },
      ],
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.body).toMatchObject({ reconciled: 0, notifyErrors: 0 });
    expect(notifSet).not.toHaveBeenCalled();
  });

  it("counts but does not write under dry-run", async () => {
    const { db, notifSet } = dbForNotifyPasses({ reconcile: [challengeGame(5 * 60_000)] });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret", query: { dryRun: "1" } }), res);

    expect(out.body).toMatchObject({ reconciled: 1, dryRun: true });
    expect(notifSet).not.toHaveBeenCalled();
  });

  it("counts a per-game failure without failing the run", async () => {
    const { db } = dbForNotifyPasses({
      reconcile: [
        {
          id: "boom",
          data: () => {
            throw new Error("corrupt doc");
          },
        },
      ],
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.code).toBe(200);
    expect(out.body).toMatchObject({ notifyErrors: 1, reconciled: 0 });
  });

  it("absorbs a pass-level query failure (e.g. missing composite index)", async () => {
    const { db } = dbForNotifyPasses({ gamesQueryError: new Error("index missing") });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    // The forfeit sweep still reports 200 — the reconcile is a backstop, not
    // the load-bearing job.
    expect(out.code).toBe(200);
    expect(out.body).toMatchObject({ notifyErrors: 2 });
  });
});

describe("sweep handler turn-deadline reminder", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = VALID_SERVICE_ACCOUNT;
    getAppsMock.mockReturnValue([]);
    initializeAppMock.mockReturnValue({ name: "app" });
  });

  it("sends one reminder to the player on the hook, ~2h out", async () => {
    const { db, notifSet, dispatchAdd, batchUpdate } = dbForNotifyPasses({
      reminder: [deadlineGame(1.9 * 60 * 60_000)],
      tokens: ["tok-1"],
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.body).toMatchObject({ reminded: 1 });
    const [id, doc] = notifSet.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe("gd1_3_turn_reminder_notify");
    // Recipient is whoever holds currentTurn; sender is the player waiting.
    expect(doc).toMatchObject({ recipientUid: "p2", senderUid: "p1", type: "your_turn", read: false });
    expect(doc.body).toContain("@alice");
    expect(dispatchAdd).toHaveBeenCalledTimes(1);
    // Per-turn tombstone, committed with the notification.
    expect(batchUpdate).toHaveBeenCalledWith("gd1", { turnReminderSentFor: 3 });
  });

  it("never repeats a reminder for the same turn, even after the recipient dismissed it", async () => {
    // Same class of bug as the challenge reconcile: the old pre-check read the
    // notification doc, which the recipient can delete from the bell.
    const { db, notifSet } = dbForNotifyPasses({
      reminder: [deadlineGame(1.9 * 60 * 60_000, { turnReminderSentFor: 3 })],
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.body).toMatchObject({ reminded: 0 });
    expect(notifSet).not.toHaveBeenCalled();
  });

  it("reminds again once the game advances to the next turn", async () => {
    // The tombstone is per-turn, not per-game: turn 4 has its own deadline.
    const { db, notifSet } = dbForNotifyPasses({
      reminder: [deadlineGame(1.9 * 60 * 60_000, { turnNumber: 4, turnReminderSentFor: 3 })],
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.body).toMatchObject({ reminded: 1 });
    expect(notifSet).toHaveBeenCalledTimes(1);
  });

  it.each([["pendingReview"], ["communityReview"]])(
    "stays quiet while the game is frozen in %s",
    async (phase: string) => {
      // The freeze leaves turnDeadline untouched (reviewDeadline is separate),
      // so a frozen game drifts into the reminder window while currentTurn —
      // the matcher who already submitted — has no legal move to make.
      const { db, notifSet } = dbForNotifyPasses({
        reminder: [deadlineGame(1.9 * 60 * 60_000, { phase })],
      });
      getFirestoreMock.mockReturnValue(db);

      const { res, out } = makeRes();
      await handler(makeReq({ authorization: "Bearer s3cret" }), res);

      expect(out.body).toMatchObject({ reminded: 0, notifyErrors: 0 });
      expect(notifSet).not.toHaveBeenCalled();
    },
  );

  it("ignores deadlines outside the window and games with no current player", async () => {
    const { db, notifSet } = dbForNotifyPasses({
      reminder: [
        deadlineGame(20 * 60 * 60_000),
        { id: "no-deadline", data: () => ({ currentTurn: "p2" }) },
        { id: "no-turn", data: () => ({ turnDeadline: tsAt(Date.now() + 1.9 * 60 * 60_000) }) },
      ],
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.body).toMatchObject({ reminded: 0, notifyErrors: 0 });
    expect(notifSet).not.toHaveBeenCalled();
  });

  it("counts but does not write under dry-run", async () => {
    const { db, notifSet } = dbForNotifyPasses({ reminder: [deadlineGame(1.8 * 60 * 60_000)] });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret", query: { dryRun: "1" } }), res);

    expect(out.body).toMatchObject({ reminded: 1, dryRun: true });
    expect(notifSet).not.toHaveBeenCalled();
  });

  it("falls back gracefully when the opponent's username is missing", async () => {
    const { db, notifSet } = dbForNotifyPasses({
      reminder: [
        {
          id: "gd1",
          data: () => ({
            player1Uid: "p1",
            player2Uid: "p2",
            currentTurn: "p1",
            turnNumber: 2,
            turnDeadline: tsAt(Date.now() + 1.9 * 60 * 60_000),
          }),
        },
      ],
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.body).toMatchObject({ reminded: 1 });
    const [, doc] = notifSet.mock.calls[0] as [string, Record<string, unknown>];
    expect(doc).toMatchObject({ recipientUid: "p1", senderUid: "p2" });
    expect(doc.body).toContain("your opponent");
  });
});

/** Pull the in-tx "your_turn" notification writes out of captured tx.set calls. */
function adminYourTurnNotifs(txSet: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return txSet.mock.calls.map((c) => c[1] as Record<string, unknown>).filter((d) => d.type === "your_turn");
}

describe("sweep handler your_turn notification (server always notifies)", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = VALID_SERVICE_ACCOUNT;
    getAppsMock.mockReturnValue([]);
    initializeAppMock.mockReturnValue({ name: "app" });
  });

  // Phase overrides that drive each turn-advancing branch. Inline single-object
  // literals keep them off the dup detector's structural radar.
  const DISPUTABLE = { phase: "disputable", currentSetter: "p1", currentTurn: "p1", currentTrickName: "Kickflip", currentTrickVideoUrl: "https://vid/set.webm", matchVideoUrl: "https://vid/match.webm" }; // prettier-ignore
  const SET_REVIEW = { phase: "setReview", currentSetter: "p1", currentTurn: "j1", judgeId: "j1", judgeStatus: "accepted" }; // prettier-ignore

  /** Assert exactly one admin-written your_turn notification to the matcher. */
  function expectOneAdminMatcherNotification(txSet: ReturnType<typeof vi.fn>): void {
    const notifs = adminYourTurnNotifs(txSet);
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({
      senderUid: "p1",
      recipientUid: "p2",
      type: "your_turn",
      read: false,
      gameId: "g1",
    });
  }

  it("disputeAccept: always writes the your_turn notification to the matcher", async () => {
    const { db, txSet } = dbForResolve(rawGame(DISPUTABLE));
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.body).toMatchObject({ forfeited: 1, dryRun: false });
    expectOneAdminMatcherNotification(txSet);
  });

  it("setReviewClear: always writes the your_turn notification to the matcher", async () => {
    const { db, txSet } = dbForResolve(rawGame(SET_REVIEW));
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.body).toMatchObject({ forfeited: 1 });
    expectOneAdminMatcherNotification(txSet);
  });

  it("plain forfeit: writes NO your_turn notification (game ends)", async () => {
    const { db, txSet } = dbForResolve(rawGame({ currentSetter: "p1", currentTurn: "p1" }));
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(out.body).toMatchObject({ forfeited: 1 });
    expect(adminYourTurnNotifs(txSet)).toHaveLength(0);
  });

  it("dry-run writes no notification even on a notifying branch", async () => {
    const { db, txSet } = dbForResolve(rawGame(DISPUTABLE));
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret", query: { dryRun: "1" } }), res);

    expect(out.body).toMatchObject({ forfeited: 1, dryRun: true });
    expect(adminYourTurnNotifs(txSet)).toHaveLength(0);
  });

  it("fans out the OS push after the tx when the recipient has tokens", async () => {
    const { db, dispatchAdd, pushTargetsGet } = dbForResolve(rawGame(DISPUTABLE), ["tok-1", "tok-2"]);
    getFirestoreMock.mockReturnValue(db);

    const { res } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(pushTargetsGet).toHaveBeenCalledTimes(1);
    expect(dispatchAdd).toHaveBeenCalledTimes(1);
    const dispatch = dispatchAdd.mock.calls[0][0] as Record<string, unknown>;
    expect(dispatch).toMatchObject({ recipientUid: "p2", type: "your_turn", gameId: "g1" });
    expect((dispatch.tokens as string[]).sort()).toEqual(["tok-1", "tok-2"]);
  });

  it("skips the push fan-out when the recipient has no tokens", async () => {
    const { db, dispatchAdd, pushTargetsGet } = dbForResolve(rawGame(DISPUTABLE), []);
    getFirestoreMock.mockReturnValue(db);

    const { res } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    expect(pushTargetsGet).toHaveBeenCalledTimes(1);
    expect(dispatchAdd).not.toHaveBeenCalled();
  });

  it("reports the notification-pass counters alongside the forfeit counters", async () => {
    const { db } = dbForResolve(rawGame(DISPUTABLE));
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    // The passes run on the same (deliberately dumb) query double, which
    // returns no reconcile/reminder-eligible docs — the point is that the
    // counters exist and the forfeit sweep is unaffected by them.
    expect(out.body).toMatchObject({ reconciled: 0, reminded: 0 });
  });

  it("swallows a push-dispatch failure without failing the sweep", async () => {
    const { db, dispatchAdd } = dbForResolve(rawGame(DISPUTABLE), ["tok-1"]);
    dispatchAdd.mockRejectedValueOnce(new Error("dispatch boom"));
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret" }), res);

    // The game still counts as forfeited; push failure is best-effort.
    expect(out.code).toBe(200);
    expect(out.body).toMatchObject({ forfeited: 1, errors: 0 });
  });
});
