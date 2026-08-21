/**
 * Server-layer tests for the dispute referee cron handler
 * (`api/cron/resolve-expired-disputes.ts`).
 *
 * These guard the operational invariants a future edit could silently break:
 * fail-closed auth, "no DB touch on auth failure", the 405 verb guard, dry-run
 * never writing, and — the load-bearing part — each verdict branch applying the
 * correct game write + stat increments + dispute close-out, plus the idempotency
 * gate that stops a re-run double-counting. firebase-admin is fully mocked — no
 * real network, no real Firestore.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── firebase-admin mocks ───────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  getAppsMock: vi.fn(),
  initializeAppMock: vi.fn(),
  certMock: vi.fn((sa: unknown) => ({ __cert: sa })),
  getFirestoreMock: vi.fn(),
  serverTimestampSentinel: { __srv: true },
  arrayUnionMock: vi.fn((v: unknown) => ({ __arrayUnion: v })),
  incrementMock: vi.fn((n: number) => ({ __inc: n })),
}));
const { getAppsMock, initializeAppMock, getFirestoreMock } = h;

vi.mock("firebase-admin/app", () => ({
  getApps: h.getAppsMock,
  initializeApp: h.initializeAppMock,
  cert: h.certMock,
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: h.getFirestoreMock,
  FieldValue: {
    serverTimestamp: () => h.serverTimestampSentinel,
    arrayUnion: h.arrayUnionMock,
    increment: h.incrementMock,
  },
  Timestamp: {
    fromMillis: (ms: number) => ({ __ts: ms, toMillis: () => ms }),
  },
}));

import handler from "../../../api/cron/resolve-expired-disputes";
import { makeRes, makeReq, VALID_SERVICE_ACCOUNT } from "./cron.test-helpers";
import { makeDisputeGame } from "./dispute.resolution.test-helpers";
import type { GameDoc } from "../games.mappers";

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

/** Timestamp-like stub whose only read is toMillis. Typed as the non-null
 * turnDeadline so it satisfies both turnDeadline and the nullable reviewDeadline. */
function ms(at: number): GameDoc["turnDeadline"] {
  return { toMillis: () => at } as unknown as GameDoc["turnDeadline"];
}

/** An expired, id-stripped game doc for the given phase. */
function rawGame(overrides: Partial<GameDoc> = {}): Record<string, unknown> {
  const past = Date.now() - 60_000;
  return makeDisputeGame({ reviewDeadline: ms(past), turnDeadline: ms(past), ...overrides }) as unknown as Record<
    string,
    unknown
  >;
}

interface DbOpts {
  game?: Record<string, unknown> | null;
  dispute?: Record<string, unknown> | null;
  pushTokens?: string[];
  failDispatch?: boolean;
}

/**
 * A db double that is phase-aware: the candidate query only yields the game when
 * its `phase` matches the `where("phase","==",…)` filter, so the two passes
 * (pendingReview, communityReview) each see the game only in their own pass.
 * tx.get routes by ref kind (game vs dispute). Writes are captured on txSet /
 * txUpdate, with each ref tagged so a test can pick out the users / clips /
 * notifications / dispute writes.
 */
function makeDb(opts: DbOpts) {
  const { game = null, dispute = null, pushTokens = [], failDispatch = false } = opts;
  const txUpdate = vi.fn();
  const txSet = vi.fn();

  const gameRef = { __kind: "game" };
  const disputeRef = { __kind: "dispute" };
  const gameSnap = game
    ? { exists: true, id: "g1", data: () => game }
    : { exists: false, id: "g1", data: () => undefined };
  const disputeSnap = dispute
    ? { exists: true, id: "g1_3", data: () => dispute }
    : { exists: false, id: "g1_3", data: () => undefined };

  const txGet = vi.fn(async (ref: { __kind: string }) => (ref.__kind === "dispute" ? disputeSnap : gameSnap));

  const dispatchAdd = vi.fn((_doc: unknown) =>
    failDispatch ? Promise.reject(new Error("dispatch boom")) : Promise.resolve(undefined),
  );
  const pushTargetsGet = vi
    .fn()
    .mockResolvedValue({ exists: pushTokens.length > 0, data: () => ({ tokens: pushTokens }) });

  function gamesCollection() {
    let phaseFilter: unknown = null;
    const chain: Record<string, (...a: unknown[]) => unknown> = {
      where(field: unknown, _op: unknown, val: unknown) {
        if (field === "phase") phaseFilter = val;
        return chain;
      },
      orderBy: () => chain,
      limit: () => chain,
      get: () =>
        Promise.resolve({ docs: game && (game as { phase?: unknown }).phase === phaseFilter ? [{ id: "g1" }] : [] }),
      doc: () => gameRef,
    };
    return chain;
  }

  const collection = vi.fn((name: string) => {
    if (name === "games") return gamesCollection();
    if (name === "disputes") return { doc: vi.fn(() => disputeRef) };
    if (name === "users") return { doc: vi.fn((uid: string) => ({ __kind: "user", uid })) };
    if (name === "clips") return { doc: vi.fn(() => ({ __kind: "clip" })) };
    if (name === "notifications") return { doc: vi.fn(() => ({ __kind: "notif" })) };
    if (name === "pushTargets") return { doc: vi.fn(() => ({ get: pushTargetsGet })) };
    if (name === "push_dispatch") return { add: dispatchAdd };
    return { doc: vi.fn(() => ({})) };
  });

  const db = {
    collection,
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ get: txGet, update: txUpdate, set: txSet }),
    ),
  };
  return { db, txUpdate, txSet, dispatchAdd, pushTargetsGet };
}

/** Writes captured on tx.set for refs of a given kind. */
function setsOfKind(
  txSet: ReturnType<typeof vi.fn>,
  kind: string,
): Array<{ ref: { uid?: string }; data: Record<string, unknown> }> {
  return txSet.mock.calls
    .filter((c) => (c[0] as { __kind?: string }).__kind === kind)
    .map((c) => ({ ref: c[0] as { uid?: string }, data: c[1] as Record<string, unknown> }));
}

function authedGet(query?: Record<string, string>) {
  return makeReq({ authorization: "Bearer s3cret", query });
}

/** Boot the shared admin-init mocks for the write-path tests. */
function bootAdmin() {
  process.env.CRON_SECRET = "s3cret";
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = VALID_SERVICE_ACCOUNT;
  getAppsMock.mockReturnValue([]);
  initializeAppMock.mockReturnValue({ name: "app" });
}

describe("resolve handler auth (fail-closed)", () => {
  it("returns 401 when the Authorization header is missing (no DB touch)", async () => {
    process.env.CRON_SECRET = "s3cret";
    const { res, out } = makeRes();
    await handler(makeReq(), res);
    expect(out.code).toBe(401);
    expect(out.body).toEqual({ error: "unauthorized" });
    expect(getAppsMock).not.toHaveBeenCalled();
    expect(getFirestoreMock).not.toHaveBeenCalled();
  });

  it("returns 401 on a wrong bearer token", async () => {
    process.env.CRON_SECRET = "s3cret";
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer wrong" }), res);
    expect(out.code).toBe(401);
    expect(getFirestoreMock).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is unset even with a bearer", async () => {
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer anything" }), res);
    expect(out.code).toBe(401);
    expect(getFirestoreMock).not.toHaveBeenCalled();
  });
});

describe("resolve handler method guard (405, after auth)", () => {
  it("rejects an authorized non-GET with 405 and no DB touch", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = VALID_SERVICE_ACCOUNT;
    const { res, out } = makeRes();
    await handler(makeReq({ authorization: "Bearer s3cret", method: "POST" }), res);
    expect(out.code).toBe(405);
    expect(out.body).toEqual({ error: "method_not_allowed" });
    expect(getFirestoreMock).not.toHaveBeenCalled();
  });

  it("returns 401 (not 405) for an unauthenticated non-GET — verb not disclosed", async () => {
    process.env.CRON_SECRET = "s3cret";
    const { res, out } = makeRes();
    await handler(makeReq({ method: "POST" }), res);
    expect(out.code).toBe(401);
    expect(getFirestoreMock).not.toHaveBeenCalled();
  });
});

describe("resolve handler init failure", () => {
  it("returns 500 when the service account env is missing", async () => {
    process.env.CRON_SECRET = "s3cret";
    getAppsMock.mockReturnValue([]);
    const { res, out } = makeRes();
    await handler(authedGet(), res);
    expect(out.code).toBe(500);
    expect(out.body).toMatchObject({ error: "init_failed" });
  });

  it("proceeds to a clean 200 summary when no games are eligible", async () => {
    bootAdmin();
    getFirestoreMock.mockReturnValue(makeDb({ game: null }).db);
    const { res, out } = makeRes();
    await handler(authedGet(), res);
    expect(out.code).toBe(200);
    expect(out.body).toMatchObject({ scanned: 0, resolved: 0, skipped: 0, errors: 0, dryRun: false });
  });
});

describe("resolve handler — pendingReview auto-accept (deferred honor swap, no stats)", () => {
  beforeEach(bootAdmin);

  it("applies the honor swap, writes landed clips + notification, NO stats", async () => {
    const { db, txUpdate, txSet } = makeDb({ game: rawGame({ phase: "pendingReview" }) });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(authedGet(), res);

    expect(out.body).toMatchObject({ scanned: 1, resolved: 1, dryRun: false });
    // Game write = honor swap: matcher (p2) becomes setter.
    expect(txUpdate).toHaveBeenCalledTimes(1);
    const write = txUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(write.phase).toBe("setting");
    expect(write.currentSetter).toBe("p2");
    expect(write.reviewFor).toBeNull();
    // No stats on a pendingReview expiry — no dispute was raised.
    expect(setsOfKind(txSet, "user")).toHaveLength(0);
    // Landed clips + a your_turn notification are written.
    expect(setsOfKind(txSet, "clip").length).toBeGreaterThan(0);
    const notifs = setsOfKind(txSet, "notif");
    expect(notifs).toHaveLength(1);
    expect(notifs[0].data).toMatchObject({ recipientUid: "p2", type: "your_turn", read: false });
  });

  it("dry-run counts the resolution but writes nothing", async () => {
    const { db, txUpdate, txSet } = makeDb({ game: rawGame({ phase: "pendingReview" }) });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(authedGet({ dryRun: "1" }), res);

    expect(out.body).toMatchObject({ scanned: 1, resolved: 1, dryRun: true });
    expect(txUpdate).not.toHaveBeenCalled();
    expect(txSet).not.toHaveBeenCalled();
  });

  it("skips (no write) when the pendingReview deadline has not passed", async () => {
    const { db, txUpdate } = makeDb({
      game: rawGame({ phase: "pendingReview", reviewDeadline: ms(Date.now() + 60_000) }),
    });
    getFirestoreMock.mockReturnValue(db);
    const { res, out } = makeRes();
    await handler(authedGet(), res);
    // Still scanned by the query double, but the in-tx re-check skips it.
    expect(out.body).toMatchObject({ resolved: 0, skipped: 1 });
    expect(txUpdate).not.toHaveBeenCalled();
  });
});

describe("resolve handler — communityReview verdicts (binding + stats + close-out)", () => {
  beforeEach(bootAdmin);

  /** Fetch the two stat writes keyed by uid. */
  function statWrites(txSet: ReturnType<typeof vi.fn>) {
    const users = setsOfKind(txSet, "user");
    const byUid = (uid: string) => users.find((u) => u.ref.uid === uid)?.data ?? {};
    return { claimer: byUid("p2"), disputer: byUid("p1") };
  }

  /** The dispute close-out write. */
  function disputeWrite(txSet: ReturnType<typeof vi.fn>) {
    return setsOfKind(txSet, "dispute")[0]?.data ?? {};
  }

  it("land majority → honor swap, tricksDisputed+1 / disputesRaised+1 / disputesWrong+1, verdict land", async () => {
    const { db, txUpdate, txSet } = makeDb({
      game: rawGame({ phase: "communityReview" }),
      dispute: { status: "open", landVotes: 2, bailVotes: 1 },
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(authedGet(), res);

    expect(out.body).toMatchObject({ scanned: 1, resolved: 1 });
    const gw = txUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(gw.phase).toBe("setting");
    expect(gw.currentSetter).toBe("p2");
    expect(gw.lastResolvedDisputeTurnNumber).toBe(3);

    const { claimer, disputer } = statWrites(txSet);
    expect(claimer.tricksDisputed).toEqual({ __inc: 1 });
    expect(disputer.disputesRaised).toEqual({ __inc: 1 });
    expect(disputer.disputesRight).toEqual({ __inc: 0 });
    expect(disputer.disputesWrong).toEqual({ __inc: 1 });

    // Matcher's claim stood → landed clips written.
    expect(setsOfKind(txSet, "clip").length).toBeGreaterThan(0);

    const d = disputeWrite(txSet);
    // 'closed' is the DisputeStatus the client mapper understands; anything
    // else read back as 'open'.
    expect(d).toMatchObject({ status: "closed", verdict: "land", resolutionApplied: true });
  });

  it("zero-vote 'none' → same honor swap, raw counts increment, no right/wrong, verdict none", async () => {
    const { db, txUpdate, txSet } = makeDb({
      game: rawGame({ phase: "communityReview" }),
      dispute: { status: "open", landVotes: 0, bailVotes: 0 },
    });
    getFirestoreMock.mockReturnValue(db);

    const { res } = makeRes();
    await handler(authedGet(), res);

    const gw = txUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(gw.currentSetter).toBe("p2");
    const { claimer, disputer } = statWrites(txSet);
    expect(claimer.tricksDisputed).toEqual({ __inc: 1 });
    expect(disputer.disputesRaised).toEqual({ __inc: 1 });
    expect(disputer.disputesRight).toEqual({ __inc: 0 });
    expect(disputer.disputesWrong).toEqual({ __inc: 0 });
    expect(disputeWrite(txSet)).toMatchObject({ verdict: "none", resolutionApplied: true });
  });

  it("bail majority (matcher < 5) → matcher takes a letter, disputesRight+1, no landed clips", async () => {
    const { db, txUpdate, txSet } = makeDb({
      game: rawGame({ phase: "communityReview", p2Letters: 1 }),
      dispute: { status: "open", landVotes: 0, bailVotes: 2 },
    });
    getFirestoreMock.mockReturnValue(db);

    const { res } = makeRes();
    await handler(authedGet(), res);

    const gw = txUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(gw.phase).toBe("setting");
    expect(gw.currentSetter).toBe("p1"); // setter keeps setting
    expect(gw.p2Letters).toBe(2);
    const { disputer } = statWrites(txSet);
    expect(disputer.disputesRight).toEqual({ __inc: 1 });
    expect(disputer.disputesWrong).toEqual({ __inc: 0 });
    // Matcher bailed → NO landed clip written.
    expect(setsOfKind(txSet, "clip")).toHaveLength(0);
    expect(disputeWrite(txSet)).toMatchObject({ verdict: "bail" });
  });

  it("bail completing the game (matcher hits 5) → complete, winner=setter, no notification", async () => {
    const { db, txUpdate, txSet, dispatchAdd } = makeDb({
      game: rawGame({ phase: "communityReview", p2Letters: 4 }),
      dispute: { status: "open", landVotes: 0, bailVotes: 1 },
      pushTokens: ["tok-1"],
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(authedGet(), res);

    expect(out.body).toMatchObject({ resolved: 1 });
    const gw = txUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(gw.status).toBe("complete");
    expect(gw.winner).toBe("p1");
    // Terminal → nobody's turn is next: no notification, no push.
    expect(setsOfKind(txSet, "notif")).toHaveLength(0);
    expect(dispatchAdd).not.toHaveBeenCalled();
    expect(disputeWrite(txSet)).toMatchObject({ verdict: "bail", resolutionApplied: true });
  });

  it("tie → retry in matching, no letter, no landed clips, verdict tie", async () => {
    const { db, txUpdate, txSet } = makeDb({
      game: rawGame({ phase: "communityReview" }),
      dispute: { status: "open", landVotes: 1, bailVotes: 1 },
    });
    getFirestoreMock.mockReturnValue(db);

    const { res } = makeRes();
    await handler(authedGet(), res);

    const gw = txUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(gw.phase).toBe("matching");
    expect(gw.matchVideoUrl).toBeNull();
    expect(setsOfKind(txSet, "clip")).toHaveLength(0);
    expect(disputeWrite(txSet)).toMatchObject({ verdict: "tie" });
  });

  it.each(["closed", "resolved"])(
    "IDEMPOTENT: an already-%s dispute no-ops (no stats, no game write)",
    async (status) => {
      const { db, txUpdate, txSet } = makeDb({
        game: rawGame({ phase: "communityReview" }),
        dispute: { status, resolutionApplied: true, verdict: "land", landVotes: 2, bailVotes: 0 },
      });
      getFirestoreMock.mockReturnValue(db);

      const { res, out } = makeRes();
      await handler(authedGet(), res);

      expect(out.body).toMatchObject({ scanned: 1, resolved: 0, skipped: 1 });
      expect(txUpdate).not.toHaveBeenCalled();
      expect(setsOfKind(txSet, "user")).toHaveLength(0);
    },
  );

  it("skips a communityReview game whose dispute doc is missing (no fabricated write)", async () => {
    const { db, txUpdate, txSet } = makeDb({ game: rawGame({ phase: "communityReview" }), dispute: null });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(authedGet(), res);

    expect(out.body).toMatchObject({ resolved: 0, skipped: 1 });
    expect(txUpdate).not.toHaveBeenCalled();
    expect(txSet).not.toHaveBeenCalled();
  });

  it("dry-run on a communityReview game writes nothing", async () => {
    const { db, txUpdate, txSet } = makeDb({
      game: rawGame({ phase: "communityReview" }),
      dispute: { status: "open", landVotes: 2, bailVotes: 0 },
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(authedGet({ dryRun: "1" }), res);

    expect(out.body).toMatchObject({ resolved: 1, dryRun: true });
    expect(txUpdate).not.toHaveBeenCalled();
    expect(txSet).not.toHaveBeenCalled();
  });

  it("fans out the OS push after commit when the recipient has tokens", async () => {
    const { db, dispatchAdd, pushTargetsGet } = makeDb({
      game: rawGame({ phase: "communityReview" }),
      dispute: { status: "open", landVotes: 2, bailVotes: 0 },
      pushTokens: ["tok-1", "tok-2"],
    });
    getFirestoreMock.mockReturnValue(db);

    const { res } = makeRes();
    await handler(authedGet(), res);

    expect(pushTargetsGet).toHaveBeenCalledTimes(1);
    expect(dispatchAdd).toHaveBeenCalledTimes(1);
    const dispatch = dispatchAdd.mock.calls[0][0] as Record<string, unknown>;
    expect(dispatch).toMatchObject({ recipientUid: "p2", type: "your_turn", gameId: "g1" });
  });

  it("swallows a push-dispatch failure without failing the run", async () => {
    const { db } = makeDb({
      game: rawGame({ phase: "communityReview" }),
      dispute: { status: "open", landVotes: 2, bailVotes: 0 },
      pushTokens: ["tok-1"],
      failDispatch: true,
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(authedGet(), res);

    expect(out.code).toBe(200);
    expect(out.body).toMatchObject({ resolved: 1, errors: 0 });
  });
});
