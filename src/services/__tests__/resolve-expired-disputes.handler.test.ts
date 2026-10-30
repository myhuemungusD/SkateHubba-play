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
  FieldPath: {
    documentId: () => "__name__",
  },
}));

import handler from "../../../api/cron/resolve-expired-disputes";
import { expectRedactedInitFailure, makeRes, makeReq, VALID_SERVICE_ACCOUNT } from "./cron.test-helpers";
import { makeDisputeGame } from "./dispute.resolution.test-helpers";
import type { GameDoc } from "../games.mappers";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
  delete process.env.DRY_RUN;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.XP_ENABLED;
  delete process.env.XP_TESTER_UIDS;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.DRY_RUN;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.XP_ENABLED;
  delete process.env.XP_TESTER_UIDS;
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
  votes?: { uid: string }[];
  users?: Record<string, Record<string, unknown>>;
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
  const { game = null, dispute = null, pushTokens = [], failDispatch = false, votes = [], users = {} } = opts;
  const txUpdate = vi.fn();
  const txSet = vi.fn();
  let votePage = 0;

  const gameRef = { __kind: "game" };
  const disputeRef = { __kind: "dispute" };
  const gameSnap = game
    ? { exists: true, id: "g1", data: () => game }
    : { exists: false, id: "g1", data: () => undefined };
  const disputeSnap = dispute
    ? { exists: true, id: "g1_3", data: () => dispute }
    : { exists: false, id: "g1_3", data: () => undefined };

  const txGet = vi.fn(async (ref: { __kind?: string; uid?: string; page?: number }) => {
    if (ref.__kind === "voteQuery") {
      const start = (ref.page ?? 0) * 100;
      const slice = votes.slice(start, start + 100);
      return {
        docs: slice.map((vote, index) => ({
          id: `v${start + index}`,
          data: () => ({ uid: vote.uid, disputeId: "g1_3" }),
        })),
      };
    }
    if (ref.__kind === "user") {
      const data = users[ref.uid ?? ""];
      return { exists: data !== undefined, data: () => data };
    }
    if (ref.__kind === "ach") return { exists: false, data: () => undefined };
    return ref.__kind === "dispute" ? disputeSnap : gameSnap;
  });

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
    if (name === "users") {
      return {
        doc: vi.fn((uid: string) => ({
          __kind: "user",
          uid,
          collection: (sub: string) => ({
            doc: (id: string) => ({ __kind: sub === "achievements" ? "ach" : "nested", uid, id }),
          }),
        })),
      };
    }
    if (name === "disputeVotes") {
      const chain = {
        where() {
          return chain;
        },
        orderBy() {
          return chain;
        },
        startAfter() {
          return chain;
        },
        limit() {
          const current = votePage;
          votePage += 1;
          const query = {
            __kind: "voteQuery" as const,
            page: current,
            startAfter() {
              return query;
            },
          };
          return query;
        },
      };
      return chain;
    }
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

  it("keeps a malformed service account's parse error out of the body and the log", async () => {
    process.env.CRON_SECRET = "s3cret";
    getAppsMock.mockReturnValue([]);
    const { res, out } = makeRes();
    await expectRedactedInitFailure(out, () => handler(authedGet(), res));
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

  it("pays 10 XP and disputeVotesCast when XP_ENABLED is true and a vote is still there", async () => {
    process.env.XP_ENABLED = "true";
    const { db, txSet } = makeDb({
      game: rawGame({ phase: "communityReview" }),
      dispute: { status: "open", landVotes: 2, bailVotes: 1 },
      votes: [{ uid: "fan" }],
      users: { fan: { xp: 20, xpDay: "2000-01-01", xpToday: 0, disputeVotesCast: 0 } },
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(authedGet(), res);

    expect(out.body).toMatchObject({ resolved: 1 });
    const voter = setsOfKind(txSet, "user").find((u) => u.ref.uid === "fan");
    expect(voter?.data.xp).toBe(30);
    expect(voter?.data.level).toBe(2);
    expect(voter?.data.disputeVotesCast).toEqual({ __inc: 1 });
    expect(setsOfKind(txSet, "ach").map((row) => (row.ref as { id?: string }).id)).toContain("votes_1");
  });

  it("pays the voter past the first page of a hundred", async () => {
    process.env.XP_ENABLED = "true";
    const votes = Array.from({ length: 101 }, (_, index) => ({ uid: `fan${index}` }));
    const users: Record<string, Record<string, unknown>> = {};
    for (const vote of votes) users[vote.uid] = { xp: 0, disputeVotesCast: 0 };
    const { db, txSet } = makeDb({
      game: rawGame({ phase: "communityReview" }),
      dispute: { status: "open", landVotes: 2, bailVotes: 1 },
      votes,
      users,
    });
    getFirestoreMock.mockReturnValue(db);

    const { res, out } = makeRes();
    await handler(authedGet(), res);

    expect(out.body).toMatchObject({ resolved: 1 });
    const paid = setsOfKind(txSet, "user")
      .map((row) => row.ref.uid)
      .filter((uid) => uid?.startsWith("fan"));
    expect(paid).toHaveLength(101);
    expect(paid).toContain("fan100");
  });

  it("does not query votes when the XP switch is off", async () => {
    const { db, txSet } = makeDb({
      game: rawGame({ phase: "communityReview" }),
      dispute: { status: "open", landVotes: 2, bailVotes: 1 },
      votes: [{ uid: "fan" }],
      users: { fan: { xp: 0 } },
    });
    getFirestoreMock.mockReturnValue(db);

    const { res } = makeRes();
    await handler(authedGet(), res);

    expect(setsOfKind(txSet, "user").some((u) => u.ref.uid === "fan")).toBe(false);
    expect(db.collection).not.toHaveBeenCalledWith("disputeVotes");
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

  it("an admin's final ruling overrides the crowd tally", async () => {
    for (const [ruling, verdict] of [
      ["bail", "bail"],
      ["land", "land"],
    ] as const) {
      const { db, txSet } = makeDb({
        game: rawGame({ phase: "communityReview", p2Letters: 1 }),
        dispute: {
          status: "open",
          landVotes: ruling === "bail" ? 9 : 0,
          bailVotes: ruling === "land" ? 9 : 0,
          adminRuling: ruling,
        },
      });
      getFirestoreMock.mockReturnValue(db);
      const { res } = makeRes();
      await handler(authedGet(), res);
      expect(disputeWrite(txSet)).toMatchObject({ verdict, resolutionApplied: true });
    }
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

describe("resolve handler edge paths", () => {
  beforeEach(bootAdmin);

  afterEach(() => {
    vi.resetModules();
  });

  type TxRef = { __kind?: string; uid?: string; id?: string };
  type TxGet = (ref: TxRef) => Promise<unknown>;

  /** Intercept the transaction's reads: `override` returns a snapshot, or undefined to fall through. */
  function overrideTxGet(db: ReturnType<typeof makeDb>["db"], override: (ref: TxRef, real: TxGet) => unknown) {
    const realTx = db.runTransaction.getMockImplementation()!;
    db.runTransaction.mockImplementation((fn) =>
      realTx((tx: unknown) => {
        const t = tx as { get: TxGet };
        return fn({ ...t, get: async (ref: TxRef) => (await override(ref, t.get)) ?? t.get(ref) });
      }),
    );
  }

  async function run(h: typeof handler = handler, req = authedGet()) {
    const { res, out } = makeRes();
    await h(req, res);
    return out;
  }

  async function freshHandler(): Promise<typeof handler> {
    vi.resetModules();
    return (await import("../../../api/cron/resolve-expired-disputes")).default;
  }

  it("reuses an existing admin app without reading the service account", async () => {
    const existing = { name: "existing" };
    getAppsMock.mockReturnValue([existing]);
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    getFirestoreMock.mockReturnValue(makeDb({}).db);
    const out = await run(await freshHandler());
    expect(out.code).toBe(200);
    expect(initializeAppMock).not.toHaveBeenCalled();
    expect(getFirestoreMock.mock.calls[0][0]).toBe(existing);
  });

  it("boots from a hand-pasted service account and logs only that it repaired it", async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = VALID_SERVICE_ACCOUNT.replace(/\\n/g, "\n");
    getFirestoreMock.mockReturnValue(makeDb({}).db);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await run(await freshHandler());
    expect(out.code).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(JSON.stringify({ event: "service_account_json_repaired" }));
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("PRIVATE KEY");
    warnSpy.mockRestore();
  });

  it("reads dry-run from DRY_RUN=true, a repeated query value, or the raw URL, and auth from the first header value", async () => {
    const pending = () => makeDb({ game: rawGame({ phase: "pendingReview" }) });
    let current = pending();
    getFirestoreMock.mockImplementation(() => current.db);

    process.env.DRY_RUN = "true";
    expect((await run()).body).toMatchObject({ dryRun: true, resolved: 1 });
    delete process.env.DRY_RUN;

    const repeated = makeReq({ query: { dryRun: ["1", "0"] } });
    repeated.headers.authorization = ["Bearer s3cret", "Bearer wrong!"];
    expect((await run(handler, repeated)).body).toMatchObject({ dryRun: true });

    const wrongFirst = makeReq();
    wrongFirst.headers.authorization = ["Bearer wrong!", "Bearer s3cret"];
    expect((await run(handler, wrongFirst)).code).toBe(401);

    current = pending();
    const raw = makeReq({ authorization: "Bearer s3cret", url: "/api/cron/resolve-expired-disputes?dryRun=1" });
    expect((await run(handler, raw)).body).toMatchObject({ dryRun: true });
    expect(current.txUpdate).not.toHaveBeenCalled();
  });

  const leftReview = () => ({ phase: "setting" });
  const noDeadline = () => ({ reviewDeadline: null });
  const notYetDue = () => ({ reviewDeadline: ms(Date.now() + 60_000) });
  it.each([
    ["pendingReview", "vanished", null],
    ["pendingReview", "left review", leftReview],
    ["pendingReview", "has no review deadline", noDeadline],
    ["communityReview", "vanished", null],
    ["communityReview", "left review", leftReview],
    ["communityReview", "has no review deadline", noDeadline],
    ["communityReview", "is not yet past its deadline", notYetDue],
  ] as const)("skips a %s game that %s by transaction time", async (phase, _label, change) => {
    const { db, txUpdate, txSet } = makeDb({
      game: rawGame({ phase }),
      dispute: { status: "open", landVotes: 1, bailVotes: 0 },
    });
    overrideTxGet(db, (ref) => {
      if (ref.__kind !== "game") return undefined;
      if (change === null) return { exists: false, id: "g1", data: () => undefined };
      const data = { ...rawGame({ phase }), ...change() };
      return { exists: true, id: "g1", data: () => data };
    });
    getFirestoreMock.mockReturnValue(db);
    const out = await run();
    expect(out.body).toMatchObject({ scanned: 1, resolved: 0, skipped: 1, errors: 0 });
    expect(txUpdate).not.toHaveBeenCalled();
    expect(txSet).not.toHaveBeenCalled();
  });

  it("auto-accepts a claim with no trick name or clips: generic copy, no clip rows, matcher from the seats", async () => {
    const { db, txUpdate, txSet } = makeDb({
      game: rawGame({
        phase: "pendingReview",
        currentTrickName: "",
        currentTrickVideoUrl: null,
        matchVideoUrl: null,
        reviewFor: null,
      }),
    });
    getFirestoreMock.mockReturnValue(db);
    const out = await run();
    expect(out.body).toMatchObject({ resolved: 1 });
    expect(txUpdate).toHaveBeenCalledTimes(1);
    expect(setsOfKind(txSet, "clip")).toHaveLength(0);
    const [notif] = setsOfKind(txSet, "notif");
    expect(notif.data).toMatchObject({ recipientUid: "p2", senderUid: "p1", title: "Your Turn!" });
    expect(String(notif.data.body)).toContain("— Trick.");
  });

  it("caps the push body for a very long trick name", async () => {
    const { db, dispatchAdd } = makeDb({
      game: rawGame({ phase: "pendingReview", currentTrickName: "x".repeat(400) }),
      pushTokens: ["tok-1"],
    });
    getFirestoreMock.mockReturnValue(db);
    await run();
    const push = dispatchAdd.mock.calls[0][0] as { notification: { title: string; body: string } };
    expect(push.notification.body).toHaveLength(200);
    expect(push.notification.title).toBe("Your Turn!");
  });

  it("treats malformed vote counts as zero (a 'none' verdict) and finds the matcher from the seats", async () => {
    const { db, txSet } = makeDb({
      game: rawGame({ phase: "communityReview", reviewFor: null }),
      dispute: { status: "open", landVotes: "7", bailVotes: -2 },
    });
    getFirestoreMock.mockReturnValue(db);
    const out = await run();
    expect(out.body).toMatchObject({ resolved: 1 });
    expect(setsOfKind(txSet, "dispute")[0].data).toMatchObject({ verdict: "none", status: "closed" });
    expect(setsOfKind(txSet, "clip").every((c) => c.data.role !== "match" || c.data.playerUid === "p2")).toBe(true);
  });

  it("pays only listed testers when XP is off: once each, skipping blank uids and missing profiles", async () => {
    process.env.XP_TESTER_UIDS = " fan , ghost ";
    const today = new Date().toISOString().slice(0, 10);
    const { db, txSet } = makeDb({
      game: rawGame({ phase: "communityReview" }),
      dispute: { status: "open", landVotes: 2, bailVotes: 1 },
      votes: [{ uid: "" }, { uid: "stranger" }, { uid: "fan" }, { uid: "fan" }, { uid: "ghost" }],
      // At today's cap: the vote counts, but no XP is added.
      users: { fan: { xp: "lots", xpDay: today, xpToday: 3000, disputeVotesCast: 4 }, stranger: { xp: 0 } },
    });
    overrideTxGet(db, (ref) => (ref.__kind === "ach" ? { exists: true, data: () => ({}) } : undefined));
    getFirestoreMock.mockReturnValue(db);
    const out = await run();
    expect(out.body).toMatchObject({ resolved: 1 });
    const voterRows = setsOfKind(txSet, "user").filter((u) => ["fan", "stranger", "ghost"].includes(u.ref.uid ?? ""));
    expect(voterRows).toEqual([
      { ref: expect.objectContaining({ uid: "fan" }), data: { disputeVotesCast: { __inc: 1 } } },
    ]);
    // The achievement already exists, so nothing is granted again.
    expect(setsOfKind(txSet, "ach")).toHaveLength(0);
  });

  it("starts a voter's counters from zero when the profile exists but reads back empty", async () => {
    process.env.XP_ENABLED = "true";
    const { db, txSet } = makeDb({
      game: rawGame({ phase: "communityReview" }),
      dispute: { status: "open", landVotes: 2, bailVotes: 1 },
      votes: [{ uid: "fan" }],
    });
    overrideTxGet(db, (ref) =>
      ref.__kind === "user" && ref.uid === "fan" ? { exists: true, data: () => undefined } : undefined,
    );
    getFirestoreMock.mockReturnValue(db);
    await run();
    const fan = setsOfKind(txSet, "user").find((u) => u.ref.uid === "fan");
    expect(fan?.data).toMatchObject({ xp: 10, xpToday: 10, disputeVotesCast: { __inc: 1 } });
  });

  it("stops paging votes when the cursor stops advancing, instead of looping forever", async () => {
    process.env.XP_ENABLED = "true";
    const page = Array.from({ length: 100 }, (_, i) => ({ id: `v${i}`, data: () => ({ uid: `fan${i % 3}` }) }));
    const { db, txSet } = makeDb({
      game: rawGame({ phase: "communityReview" }),
      dispute: { status: "open", landVotes: 2, bailVotes: 1 },
      users: { fan0: { xp: 0 }, fan1: { xp: 0 }, fan2: { xp: 0 } },
    });
    let votePages = 0;
    overrideTxGet(db, (ref) => {
      if (ref.__kind !== "voteQuery") return undefined;
      votePages += 1;
      return { docs: page };
    });
    getFirestoreMock.mockReturnValue(db);
    const out = await run();
    expect(out.body).toMatchObject({ resolved: 1 });
    expect(votePages).toBe(2);
    const paid = setsOfKind(txSet, "user").filter((u) => u.ref.uid?.startsWith("fan"));
    expect(paid.map((u) => u.ref.uid).sort()).toEqual(["fan0", "fan1", "fan2"]);
  });

  it("counts a failed game transaction as an error and logs only phase, id and code", async () => {
    const { db } = makeDb({ game: rawGame({ phase: "pendingReview" }) });
    db.runTransaction.mockRejectedValue(Object.assign(new Error("contention uid=p2 secret"), { code: "aborted" }));
    getFirestoreMock.mockReturnValue(db);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await run();
    expect(out.code).toBe(200);
    expect(out.body).toMatchObject({ scanned: 1, resolved: 0, errors: 1 });
    expect(warnSpy).toHaveBeenCalledWith(
      JSON.stringify({ event: "resolve_game_failed", phase: "pendingReview", gameId: "g1", code: "aborted" }),
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("secret");
    warnSpy.mockRestore();
  });

  it("returns 500 resolve_failed with the partial summary when a candidate query fails", async () => {
    const { db } = makeDb({});
    db.collection.mockImplementation(() => {
      const q = {
        where: () => q,
        orderBy: () => q,
        limit: () => q,
        get: () => Promise.reject(new Error("index missing")),
      };
      return q as never;
    });
    getFirestoreMock.mockReturnValue(db);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await run();
    expect(out.code).toBe(500);
    expect(out.body).toMatchObject({ error: "resolve_failed", scanned: 0, resolved: 0 });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"event":"resolve_failed"'));
    warnSpy.mockRestore();
  });
});
