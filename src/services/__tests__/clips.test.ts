import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/firestore ────────────────── */
const {
  mockCollection,
  mockDoc,
  mockQuery,
  mockWhere,
  mockOrderBy,
  mockLimit,
  mockStartAfter,
  mockDocumentId,
  mockGetDocs,
  mockDeleteDoc,
  mockServerTimestamp,
  mockRunTransaction,
  FakeTimestamp,
} = vi.hoisted(() => {
  class FakeTimestamp {
    constructor(public _ms: number) {}
    toMillis() {
      return this._ms;
    }
  }
  return {
    mockCollection: vi.fn((_db: unknown, name: string) => ({ __collection: name })),
    mockDoc: vi.fn((_db: unknown, collectionName: string, id: string) => ({
      __path: `${collectionName}/${id}`,
      id,
    })),
    mockQuery: vi.fn((...args: unknown[]) => ({ __query: args })),
    mockWhere: vi.fn((field: unknown, op: unknown, value: unknown) => ({ __where: { field, op, value } })),
    mockOrderBy: vi.fn((field: unknown, dir: unknown) => ({ __orderBy: { field, dir } })),
    mockLimit: vi.fn((n: number) => ({ __limit: n })),
    mockStartAfter: vi.fn((...values: unknown[]) => ({ __startAfter: values })),
    mockDocumentId: vi.fn(() => ({ __documentId: true })),
    mockGetDocs: vi.fn(),
    mockDeleteDoc: vi.fn().mockResolvedValue(undefined),
    mockServerTimestamp: vi.fn(() => "SERVER_TS"),
    mockRunTransaction: vi.fn(),
    FakeTimestamp,
  };
});

vi.mock("firebase/firestore", () => ({
  collection: mockCollection,
  doc: mockDoc,
  query: mockQuery,
  where: mockWhere,
  orderBy: mockOrderBy,
  limit: mockLimit,
  startAfter: mockStartAfter,
  documentId: mockDocumentId,
  getDocs: mockGetDocs,
  deleteDoc: mockDeleteDoc,
  serverTimestamp: mockServerTimestamp,
  runTransaction: mockRunTransaction,
  Timestamp: FakeTimestamp,
}));

vi.mock("../../firebase");

import {
  writeLandedClipsInTransaction,
  fetchClipsFeed,
  deleteUserClips,
  upvoteClip,
  fetchClipUpvoteState,
  AlreadyUpvotedError,
  _resetTopIndexCircuitBreaker,
  type LandedClipContext,
  type ClipsFeedCursor,
} from "../clips";

/* ── Helpers ────────────────────────────────── */

function makeTx() {
  // Cast: the real Transaction has a richer surface (delete, runQuery, etc.)
  // that writeLandedClipsInTransaction never invokes. Casting through unknown
  // keeps the test focused on the methods actually exercised.
  return { set: vi.fn(), update: vi.fn(), get: vi.fn() } as unknown as import("firebase/firestore").Transaction & {
    set: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
}

function baseCtx(overrides: Partial<LandedClipContext> = {}): LandedClipContext {
  return {
    gameId: "g1",
    turnNumber: 3,
    trickName: "tre flip",
    setterUid: "p1",
    setterUsername: "alice",
    matcherUid: "p2",
    matcherUsername: "bob",
    setVideoUrl: "https://example.com/set.webm",
    matchVideoUrl: "https://example.com/match.webm",
    matcherLanded: true,
    spotId: "spot-abc",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ── writeLandedClipsInTransaction ───────────── */

describe("writeLandedClipsInTransaction", () => {
  it("writes both set and match clips when the matcher landed and both videos exist", () => {
    const tx = makeTx();

    writeLandedClipsInTransaction(tx, baseCtx());

    expect(tx.set).toHaveBeenCalledTimes(2);
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "clips", "g1_3_set");
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "clips", "g1_3_match");

    const [, setPayload] = tx.set.mock.calls[0];
    expect(setPayload).toMatchObject({
      gameId: "g1",
      turnNumber: 3,
      role: "set",
      playerUid: "p1",
      playerUsername: "alice",
      trickName: "tre flip",
      videoUrl: "https://example.com/set.webm",
      spotId: "spot-abc",
      createdAt: "SERVER_TS",
      moderationStatus: "active",
      upvoteCount: 0,
    });

    const [, matchPayload] = tx.set.mock.calls[1];
    expect(matchPayload).toMatchObject({
      role: "match",
      playerUid: "p2",
      playerUsername: "bob",
      videoUrl: "https://example.com/match.webm",
      createdAt: "SERVER_TS",
      moderationStatus: "active",
      upvoteCount: 0,
    });
  });

  it("omits the match clip when the matcher missed (set clip still written)", () => {
    const tx = makeTx();

    writeLandedClipsInTransaction(tx, baseCtx({ matcherLanded: false }));

    expect(tx.set).toHaveBeenCalledTimes(1);
    const [, payload] = tx.set.mock.calls[0];
    expect(payload.role).toBe("set");
  });

  it("omits the match clip when matchVideoUrl is null even if matcherLanded", () => {
    const tx = makeTx();

    writeLandedClipsInTransaction(tx, baseCtx({ matchVideoUrl: null }));

    expect(tx.set).toHaveBeenCalledTimes(1);
    const [, payload] = tx.set.mock.calls[0];
    expect(payload.role).toBe("set");
  });

  it("omits the set clip when setVideoUrl is null", () => {
    const tx = makeTx();

    writeLandedClipsInTransaction(tx, baseCtx({ setVideoUrl: null }));

    expect(tx.set).toHaveBeenCalledTimes(1);
    const [, payload] = tx.set.mock.calls[0];
    expect(payload.role).toBe("match");
  });

  it("writes nothing when no videos are present", () => {
    const tx = makeTx();

    writeLandedClipsInTransaction(tx, baseCtx({ setVideoUrl: null, matchVideoUrl: null, matcherLanded: false }));

    expect(tx.set).not.toHaveBeenCalled();
  });

  it("propagates null spotId verbatim to the clip payload", () => {
    const tx = makeTx();

    writeLandedClipsInTransaction(tx, baseCtx({ spotId: null }));

    const [, payload] = tx.set.mock.calls[0];
    expect(payload.spotId).toBeNull();
  });
});

/* ── fetchClipsFeed ──────────────────────────── */

function makeClipSnap(id: string, data: Record<string, unknown>) {
  return { id, data: () => data };
}

function validClipData(overrides: Record<string, unknown> = {}) {
  return {
    gameId: "g1",
    turnNumber: 2,
    role: "set",
    playerUid: "p1",
    playerUsername: "alice",
    trickName: "kickflip",
    videoUrl: "https://example.com/x.webm",
    spotId: "spot-1",
    createdAt: new FakeTimestamp(1_700_000_000_000),
    moderationStatus: "active",
    upvoteCount: 0,
    ...overrides,
  };
}

describe("fetchClipsFeed (sort='new')", () => {
  it("queries active clips ordered by createdAt desc (with docId tiebreaker) and returns mapped docs", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        makeClipSnap("g1_2_set", validClipData()),
        makeClipSnap("g1_2_match", validClipData({ role: "match", playerUid: "p2", playerUsername: "bob" })),
      ],
    });

    const page = await fetchClipsFeed(null, 20, "new");

    // Feed must filter to active clips only so hidden-by-moderation content
    // never reaches users (App Store Guideline 1.2).
    expect(mockWhere).toHaveBeenCalledWith("moderationStatus", "==", "active");
    expect(mockOrderBy).toHaveBeenCalledWith("createdAt", "desc");
    expect(mockOrderBy).toHaveBeenCalledWith({ __documentId: true }, "desc");
    // Regression guard: legacy 'new' sort never orders by upvoteCount, so a
    // user flipping back to New still hits the original composite index.
    expect(mockOrderBy).not.toHaveBeenCalledWith("upvoteCount", expect.anything());
    expect(mockLimit).toHaveBeenCalledWith(20);
    expect(mockStartAfter).not.toHaveBeenCalled();

    expect(page.clips).toHaveLength(2);
    expect(page.clips[0]).toMatchObject({ id: "g1_2_set", role: "set", playerUid: "p1", moderationStatus: "active" });
    expect(page.clips[1]).toMatchObject({ id: "g1_2_match", role: "match", playerUid: "p2" });
    expect(page.cursor).toEqual({
      createdAt: expect.any(FakeTimestamp),
      id: "g1_2_match",
    });
  });

  it("defaults moderationStatus to 'active' on legacy docs that predate the field", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("legacy", validClipData({ moderationStatus: undefined }))],
    });
    const page = await fetchClipsFeed(null, 20, "new");
    expect(page.clips[0].moderationStatus).toBe("active");
  });

  it("preserves 'hidden' moderationStatus when the backend surfaces one (defense in depth)", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("g1_2_set", validClipData({ moderationStatus: "hidden" }))],
    });
    const page = await fetchClipsFeed(null, 20, "new");
    expect(page.clips[0].moderationStatus).toBe("hidden");
  });

  it("applies the cursor via startAfter(createdAt, id) when provided", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    const cursor: ClipsFeedCursor = {
      createdAt: new FakeTimestamp(1_700_000_000_000) as unknown as ClipsFeedCursor["createdAt"],
      id: "g1_5_match",
    };
    const page = await fetchClipsFeed(cursor, 10, "new");

    expect(mockStartAfter).toHaveBeenCalledWith(cursor.createdAt, cursor.id);
    expect(mockLimit).toHaveBeenCalledWith(10);
    expect(page.clips).toHaveLength(0);
    expect(page.cursor).toBeNull();
  });

  it("clamps pageSize into [1, 50]", async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });

    await fetchClipsFeed(null, 0, "new");
    expect(mockLimit).toHaveBeenLastCalledWith(1);

    await fetchClipsFeed(null, 999, "new");
    expect(mockLimit).toHaveBeenLastCalledWith(50);
  });

  it("returns a null cursor when the trailing doc has no createdAt", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("g1_2_set", validClipData({ createdAt: null }))],
    });

    const page = await fetchClipsFeed(null, 20, "new");

    expect(page.clips).toHaveLength(1);
    expect(page.clips[0].createdAt).toBeNull();
    expect(page.cursor).toBeNull();
  });

  it("coerces spotId to null when it's not a string", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("g1_2_set", validClipData({ spotId: undefined }))],
    });

    const page = await fetchClipsFeed(null, 20, "new");
    expect(page.clips[0].spotId).toBeNull();
  });

  it("filters out a doc with empty data instead of throwing the whole page away", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ id: "broken", data: () => undefined }, makeClipSnap("g1_2_set", validClipData())],
    });

    const page = await fetchClipsFeed(null, 20, "new");
    expect(page.clips).toHaveLength(1);
    expect(page.clips[0].id).toBe("g1_2_set");
  });

  it("filters out a doc with an invalid role", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("bad", validClipData({ role: "judge" })), makeClipSnap("g1_2_set", validClipData())],
    });

    const page = await fetchClipsFeed(null, 20, "new");
    expect(page.clips).toHaveLength(1);
    expect(page.clips[0].id).toBe("g1_2_set");
  });

  it("filters out docs with missing or wrong-typed required fields", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("bad", validClipData({ videoUrl: 42 })), makeClipSnap("g1_2_set", validClipData())],
    });

    const page = await fetchClipsFeed(null, 20, "new");
    expect(page.clips).toHaveLength(1);
    expect(page.clips[0].id).toBe("g1_2_set");
  });

  it("returns an empty clips array (not a throw) when the entire page is malformed", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ id: "broken", data: () => undefined }],
    });

    const page = await fetchClipsFeed(null, 20, "new");
    expect(page.clips).toHaveLength(0);
    // Cursor stays null so the caller can stop paginating cleanly.
    expect(page.cursor).toBeNull();
  });

  it("advances the cursor past a malformed trailing doc using the raw timestamp", async () => {
    // A real-world page where the trailing doc is malformed: pagination must
    // still progress so the next fetch doesn't re-receive the same window.
    const trailingTs = new FakeTimestamp(1_700_000_000_500);
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        makeClipSnap("g1_2_set", validClipData()),
        { id: "g1_3_set", data: () => ({ ...validClipData(), createdAt: trailingTs, role: "judge" }) },
      ],
    });

    const page = await fetchClipsFeed(null, 20, "new");
    expect(page.clips).toHaveLength(1);
    expect(page.cursor).toEqual({ createdAt: trailingTs, id: "g1_3_set" });
  });

  it("accepts a createdAt that implements toMillis() but isn't a Timestamp instance", async () => {
    const duck = { toMillis: () => 1 };
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("g1_2_set", validClipData({ createdAt: duck }))],
    });

    const page = await fetchClipsFeed(null, 20, "new");
    expect(page.clips[0].createdAt).toBe(duck);
  });

  it("propagates a numeric upvoteCount on the persisted doc through to the mapped clip", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("g1_2_set", validClipData({ upvoteCount: 42 }))],
    });
    const page = await fetchClipsFeed();
    expect(page.clips[0].upvoteCount).toBe(42);
  });

  it("defaults upvoteCount to 0 on legacy docs that predate the aggregate", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("legacy", validClipData({ upvoteCount: undefined }))],
    });
    const page = await fetchClipsFeed();
    expect(page.clips[0].upvoteCount).toBe(0);
  });

  it("treats a negative upvoteCount as a corrupt value and defaults to 0", async () => {
    // Defense-in-depth: rules forbid negative deltas, but a malformed write
    // via Admin SDK shouldn't be able to surface a nonsensical UI state.
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("g1_2_set", validClipData({ upvoteCount: -3 }))],
    });
    const page = await fetchClipsFeed();
    expect(page.clips[0].upvoteCount).toBe(0);
  });
});

describe("fetchClipsFeed (sort='top', the default)", () => {
  it("defaults to sort='top' — orders by upvoteCount desc then createdAt desc with __name__ tiebreak", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        makeClipSnap("hot", validClipData({ upvoteCount: 9 })),
        makeClipSnap("warm", validClipData({ upvoteCount: 4 })),
      ],
    });

    const page = await fetchClipsFeed();

    expect(mockWhere).toHaveBeenCalledWith("moderationStatus", "==", "active");
    expect(mockOrderBy).toHaveBeenCalledWith("upvoteCount", "desc");
    expect(mockOrderBy).toHaveBeenCalledWith("createdAt", "desc");
    expect(mockOrderBy).toHaveBeenCalledWith({ __documentId: true }, "desc");
    // upvoteCount must be the FIRST orderBy so 'top' ranks by votes;
    // createdAt is the no-upvotes-yet fallback tiebreaker.
    const orderByFields = mockOrderBy.mock.calls.map((c) => c[0]);
    expect(orderByFields[0]).toBe("upvoteCount");
    expect(orderByFields[1]).toBe("createdAt");

    expect(page.clips).toHaveLength(2);
    expect(page.clips[0]).toMatchObject({ id: "hot", upvoteCount: 9 });
    expect(page.cursor).toEqual({
      createdAt: expect.any(FakeTimestamp),
      id: "warm",
      upvoteCount: 4,
    });
  });

  it("threads upvoteCount through startAfter(upvoteCount, createdAt, id) for top-sort cursors", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    const ts = new FakeTimestamp(1_700_000_000_000) as unknown as ClipsFeedCursor["createdAt"];
    const cursor: ClipsFeedCursor = { createdAt: ts, id: "g1_5_match", upvoteCount: 5 };

    await fetchClipsFeed(cursor, 10, "top");

    expect(mockStartAfter).toHaveBeenCalledWith(5, ts, "g1_5_match");
  });

  it("defaults a missing cursor.upvoteCount to 0 (defensive — not a real path)", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    const ts = new FakeTimestamp(1_700_000_000_000) as unknown as ClipsFeedCursor["createdAt"];
    // Caller round-tripped a 'new'-sourced cursor with sort='top' — wrong
    // but possible. Don't crash; degrade gracefully to upvoteCount=0.
    const cursor: ClipsFeedCursor = { createdAt: ts, id: "g1_5_match" };

    await fetchClipsFeed(cursor, 10, "top");

    expect(mockStartAfter).toHaveBeenCalledWith(0, ts, "g1_5_match");
  });

  it("projects upvoteCount onto every clip (defaults missing/non-numeric to 0)", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        makeClipSnap("a", validClipData({ upvoteCount: 3 })),
        makeClipSnap("b", validClipData({ upvoteCount: undefined })),
        makeClipSnap("c", validClipData({ upvoteCount: "broken" })),
      ],
    });

    const page = await fetchClipsFeed(null, 20, "top");

    expect(page.clips.map((c) => ({ id: c.id, upvoteCount: c.upvoteCount }))).toEqual([
      { id: "a", upvoteCount: 3 },
      { id: "b", upvoteCount: 0 },
      { id: "c", upvoteCount: 0 },
    ]);
  });

  it("returns a top-sort cursor that reads upvoteCount off the trailing raw doc", async () => {
    const trailingTs = new FakeTimestamp(1_700_000_000_500);
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("a", validClipData({ upvoteCount: 7, createdAt: trailingTs }))],
    });

    const page = await fetchClipsFeed(null, 20, "top");

    expect(page.cursor).toEqual({ createdAt: trailingTs, id: "a", upvoteCount: 7 });
  });

  it("falls back to the parsed clip's upvoteCount when the trailing raw doc has a duck-typed createdAt", async () => {
    // Duck-typed createdAt isn't a Timestamp instance, so the raw-doc cursor
    // path fails and we fall through to the per-clip IIFE. Ensure the top
    // branch in that fallback still includes upvoteCount.
    const duck = { toMillis: () => 1 };
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("a", validClipData({ upvoteCount: 4, createdAt: duck }))],
    });

    const page = await fetchClipsFeed(null, 20, "top");

    expect(page.cursor).toEqual({ createdAt: duck, id: "a", upvoteCount: 4 });
  });
});

describe("fetchClipsFeed (failed-precondition fallback)", () => {
  beforeEach(() => {
    // Each case starts with a fresh breaker so they can independently
    // exercise the first-failure path without leaking state.
    _resetTopIndexCircuitBreaker();
  });

  function missingIndexError(message = "The query requires an index. You can create it here: ..."): Error {
    const err = new Error(message);
    (err as Error & { code?: string }).code = "failed-precondition";
    return err;
  }

  it("falls back from sort='top' to sort='new' when the top-index isn't available yet", async () => {
    // The 4-field top index can be still-building or undeployed in
    // production. The lobby would otherwise show "Feed temporarily
    // unavailable" — instead we degrade silently to the new-sort feed so
    // viewers see clips while ops resolves the missing index.
    mockGetDocs.mockRejectedValueOnce(missingIndexError());
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("g1_2_set", validClipData({ upvoteCount: 0 }))],
    });

    const page = await fetchClipsFeed(null, 20, "top");

    expect(page.clips).toHaveLength(1);
    expect(page.clips[0].id).toBe("g1_2_set");
    // On fallback we drop the upvoteCount orderBy so the cursor must
    // resemble a 'new'-sort cursor (no upvoteCount field).
    expect(page.cursor).toEqual({ createdAt: expect.any(FakeTimestamp), id: "g1_2_set" });
    // Sanity: the fallback issued the new-sort orderBy on its second
    // attempt rather than the upvoteCount-ranked one.
    const orderByFields = mockOrderBy.mock.calls.map((c) => c[0]);
    expect(orderByFields).toContain("createdAt");
  });

  it("drops the cursor on fallback so an incompatible top-cursor doesn't crash startAfter", async () => {
    // top-cursor threads upvoteCount through startAfter. Re-using it in a
    // 'new' query would hand startAfter the wrong number of values.
    mockGetDocs.mockRejectedValueOnce(missingIndexError());
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    const ts = new FakeTimestamp(1_700_000_000_000) as unknown as ClipsFeedCursor["createdAt"];
    const cursor: ClipsFeedCursor = { createdAt: ts, id: "g1_5_match", upvoteCount: 5 };

    await fetchClipsFeed(cursor, 20, "top");

    // First (failing) call wired the cursor with upvoteCount; the
    // fallback call must *not* call startAfter at all.
    expect(mockStartAfter).toHaveBeenCalledTimes(1);
    expect(mockStartAfter).toHaveBeenCalledWith(5, ts, "g1_5_match");
  });

  it("does not fall back when sort='new' itself hits failed-precondition (rethrows)", async () => {
    // No safer fallback exists once the new-sort index is also missing —
    // surface the error so the lobby still renders its retry CTA.
    mockGetDocs.mockRejectedValueOnce(missingIndexError());

    await expect(fetchClipsFeed(null, 20, "new")).rejects.toMatchObject({ code: "failed-precondition" });
    // Single attempt — no fallback was triggered.
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
  });

  it("does not fall back on permission-denied (rethrows verbatim)", async () => {
    // permission-denied is an auth/rules problem, not an index problem.
    // Falling back to 'new' would mask the real failure, so let it surface.
    const err = new Error("Missing or insufficient permissions.");
    (err as Error & { code?: string }).code = "permission-denied";
    mockGetDocs.mockRejectedValueOnce(err);

    await expect(fetchClipsFeed(null, 20, "top")).rejects.toMatchObject({ code: "permission-denied" });
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
  });

  it("does not fall back when the rejection isn't an object (string / undefined throws rethrow as-is)", async () => {
    // Defensive: some intermediaries strip error objects to bare strings.
    // A non-object rejection can't carry a 'failed-precondition' code, so
    // the fallback path correctly leaves it alone. withRetry treats
    // non-Error rejections as retryable, so persist the rejection across
    // attempts; the final throw should be the original string verbatim.
    mockGetDocs.mockRejectedValue("network died");
    await expect(fetchClipsFeed(null, 20, "top")).rejects.toBe("network died");
  }, 30_000);

  it("treats failed-precondition with no readable message as a missing index (triggers fallback)", async () => {
    // Tolerant matcher: when an error envelope has the right code but the
    // message has been stripped by a proxy/SDK wrapper, fall back rather
    // than surfacing "Feed temporarily unavailable" to the viewer. The
    // worst case is we serve 'new'-sorted clips when the failure was
    // actually some other failed-precondition variant — acceptable for a
    // read-only feed.
    //
    // Use an Error instance so withRetry's isRetryable() classifies the
    // permanent code immediately and rethrows on the first attempt — that
    // routes through fetchClipsFeed's catch block (where isMissingIndexError
    // is consulted) instead of the SDK-level retry path.
    const err = new Error();
    (err as unknown as { message: unknown }).message = undefined;
    (err as Error & { code: string }).code = "failed-precondition";
    mockGetDocs.mockRejectedValueOnce(err);
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    const page = await fetchClipsFeed(null, 20, "top");
    expect(page.clips).toEqual([]);
    // Two calls total: the failing top attempt + the fallback new attempt.
    expect(mockGetDocs).toHaveBeenCalledTimes(2);
  });

  it("latches the breaker after one failure so subsequent top calls skip the failing query", async () => {
    // First call: top fails, fallback to new succeeds — costs 2 reads.
    mockGetDocs.mockRejectedValueOnce(missingIndexError());
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("g1_2_set", validClipData())],
    });
    await fetchClipsFeed(null, 20, "top");
    expect(mockGetDocs).toHaveBeenCalledTimes(2);

    // Second call: breaker latched, route directly to new — 1 read only.
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("g1_3_set", validClipData())],
    });
    const page = await fetchClipsFeed(null, 20, "top");
    expect(mockGetDocs).toHaveBeenCalledTimes(3);
    expect(page.clips[0].id).toBe("g1_3_set");

    // Same on a third call — no further failing-top attempts ever issued.
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    await fetchClipsFeed(null, 20, "top");
    expect(mockGetDocs).toHaveBeenCalledTimes(4);

    // Verify the post-latch calls used the new-sort orderBy chain (no
    // upvoteCount), not the failing top chain.
    const orderByFieldsAfterLatch = mockOrderBy.mock.calls.map((c) => c[0]);
    // upvoteCount only appears in the very first (failing) attempt.
    const upvoteCountInvocations = orderByFieldsAfterLatch.filter((f) => f === "upvoteCount").length;
    expect(upvoteCountInvocations).toBe(1);
  });

  it("drops a top-shaped cursor when the breaker is already latched", async () => {
    // Latch the breaker via a first failed call.
    mockGetDocs.mockRejectedValueOnce(missingIndexError());
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    await fetchClipsFeed(null, 20, "top");

    // Now hand fetchClipsFeed a top-shaped cursor (with upvoteCount). The
    // post-latch path must drop it — feeding upvoteCount into a new-sort
    // startAfter would mismatch the orderBy chain length and crash.
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    const ts = new FakeTimestamp(1_700_000_000_000) as unknown as ClipsFeedCursor["createdAt"];
    const topCursor: ClipsFeedCursor = { createdAt: ts, id: "g1_5_match", upvoteCount: 5 };
    await fetchClipsFeed(topCursor, 20, "top");

    // The post-latch call goes straight to runFeedQuery(null, ...) — no
    // startAfter at all on that invocation.
    expect(mockStartAfter).not.toHaveBeenCalled();
  });

  it("breaker only affects sort='top'; explicit sort='new' is unaffected", async () => {
    // Latch via a top failure.
    mockGetDocs.mockRejectedValueOnce(missingIndexError());
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    await fetchClipsFeed(null, 20, "top");

    // Caller explicitly asks for sort='new' — runs directly, with cursor.
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    const ts = new FakeTimestamp(1_700_000_000_000) as unknown as ClipsFeedCursor["createdAt"];
    const newCursor: ClipsFeedCursor = { createdAt: ts, id: "g1_5_match" };
    await fetchClipsFeed(newCursor, 20, "new");

    expect(mockStartAfter).toHaveBeenCalledWith(ts, "g1_5_match");
  });
});

/* ── deleteUserClips (account-deletion cascade) ──────────────── */

describe("deleteUserClips", () => {
  it("queries clips by playerUid and deletes each one", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ id: "g1_2_set" }, { id: "g7_4_match" }],
    });

    await deleteUserClips("p1");

    expect(mockWhere).toHaveBeenCalledWith("playerUid", "==", "p1");
    expect(mockDeleteDoc).toHaveBeenCalledTimes(2);
    const deletedIds = mockDeleteDoc.mock.calls.map(([ref]) => (ref as { id: string }).id);
    expect(deletedIds).toEqual(["g1_2_set", "g7_4_match"]);
  });

  it("is a no-op when the user owns no clips", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    await deleteUserClips("stranger");

    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it("swallows the query error and returns so account deletion can continue", async () => {
    // Use a permanent error code so withRetry aborts immediately rather than
    // retrying into the default `undefined` mock return.
    mockGetDocs.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));

    await expect(deleteUserClips("p1")).resolves.toBeUndefined();
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it("tolerates per-doc delete failures without throwing", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ id: "ok" }, { id: "fails" }],
    });
    mockDeleteDoc.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("transient"));

    await expect(deleteUserClips("p1")).resolves.toBeUndefined();
    expect(mockDeleteDoc).toHaveBeenCalledTimes(2);
  });
});

/* ── upvoteClip ────────────────────────────────── */

describe("upvoteClip", () => {
  type ObservedTx = {
    set: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };

  /**
   * Wires `mockRunTransaction` to capture and return the Transaction stub
   * the service body sees. The service issues two `tx.get` calls — one for
   * the vote doc (drives the AlreadyUpvotedError branch) and one for the
   * clip doc (drives the post-tx return count). The mock differentiates by
   * the ref's `__path` prefix produced by the firestore mockDoc helper.
   */
  function captureTxOnce(
    voteExists: boolean,
    currentUpvoteCount: number | "no-clip-doc" | "non-numeric" = 0,
  ): { observed: () => ObservedTx } {
    let captured: ObservedTx | undefined;
    mockRunTransaction.mockImplementationOnce(async (_db: unknown, cb: (tx: unknown) => Promise<void>) => {
      const tx: ObservedTx = {
        get: vi.fn().mockImplementation(async (ref: { __path?: string }) => {
          const path = ref.__path ?? "";
          if (path.startsWith("clipVotes/")) {
            return { exists: () => voteExists };
          }
          if (path.startsWith("clips/")) {
            // 'no-clip-doc' covers the legacy / pre-backfill branch where
            // the clip doc didn't exist when the vote was placed (defensive;
            // shouldn't happen in practice because clip docs are written
            // first inside the parent game transaction).
            if (currentUpvoteCount === "no-clip-doc") {
              return { exists: () => false };
            }
            // 'non-numeric' covers a corrupted clip doc — upvoteCount field
            // present but not a finite number. The service must coerce to 0.
            if (currentUpvoteCount === "non-numeric") {
              return { exists: () => true, data: () => ({ upvoteCount: "broken" }) };
            }
            return { exists: () => true, data: () => ({ upvoteCount: currentUpvoteCount }) };
          }
          throw new Error(`Unexpected ref path in tx.get: ${path}`);
        }),
        set: vi.fn(),
        update: vi.fn(),
      };
      captured = tx;
      await cb(tx);
    });
    return {
      observed: () => {
        if (!captured) throw new Error("transaction was never invoked");
        return captured;
      },
    };
  }

  it("writes the vote inside a transaction and returns the post-increment count from the in-tx clip read", async () => {
    captureTxOnce(false, 6);

    const count = await upvoteClip("me", "g1_2_set");

    // Returned count is current+1, derived from the in-transaction read —
    // no follow-up aggregate query was needed.
    expect(count).toBe(7);
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "clipVotes", "me_g1_2_set");
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "clips", "g1_2_set");
  });

  it("writes the literal post-increment count to the clip aggregate (not increment(1))", async () => {
    const cap = captureTxOnce(false, 1);

    await upvoteClip("me", "g1_2_set");

    // Both writes must land on the same Transaction object — that's what
    // makes the aggregate consistent with the votes underneath.
    const tx = cap.observed();
    expect(tx.set).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledTimes(1);

    const [voteRef, votePayload] = tx.set.mock.calls[0];
    expect((voteRef as { __path: string }).__path).toBe("clipVotes/me_g1_2_set");
    expect(votePayload).toMatchObject({ uid: "me", clipId: "g1_2_set" });

    const [clipRef, clipPayload] = tx.update.mock.calls[0];
    expect((clipRef as { __path: string }).__path).toBe("clips/g1_2_set");
    // Literal write — current(1) + 1 = 2. The rule explicitly accepts
    // `upvoteCount == prev + 1` paired with a vote-doc create-after, so a
    // literal write is rule-equivalent to increment(1) but lets us return
    // the authoritative count without a second round-trip.
    expect(clipPayload).toEqual({ upvoteCount: 2 });
  });

  it("treats a missing or non-numeric upvoteCount on the clip as 0 (legacy / pre-backfill path)", async () => {
    // captureTxOnce defaults clip data to { upvoteCount: 0 }; verify that
    // legacy clips with no field at all still take the 0 → 1 path rather
    // than crashing or writing NaN.
    const cap = captureTxOnce(false, 0);
    let count = 0;
    count = await upvoteClip("me", "g1_2_set");
    expect(count).toBe(1);
    const [, clipPayload] = cap.observed().update.mock.calls[0];
    expect(clipPayload).toEqual({ upvoteCount: 1 });
  });

  it("coerces a non-numeric upvoteCount on the clip doc to 0 (defense against corrupted writes)", async () => {
    // A clip doc with upvoteCount = "broken" (or NaN, or undefined) must
    // not be allowed to write NaN+1 = NaN as the new aggregate; the rule
    // requires `upvoteCount is int`, so a NaN write would be rejected at
    // the server. Coerce to 0 in code so the literal write is always int.
    const cap = captureTxOnce(false, "non-numeric");
    const count = await upvoteClip("me", "g1_2_set");
    expect(count).toBe(1);
    const [, clipPayload] = cap.observed().update.mock.calls[0];
    expect(clipPayload).toEqual({ upvoteCount: 1 });
  });

  it("seeds count from 0 when the clip doc doesn't exist at tx-time (defensive legacy path)", async () => {
    // Belt-and-braces: rules read upvoteCount via get('upvoteCount', 0)
    // so a clip-doc-missing case must still write 1, not NaN. This is a
    // defensive branch — clip docs are written inside the parent game's
    // transaction so they should always exist by the time anyone votes.
    const cap = captureTxOnce(false, "no-clip-doc");
    const count = await upvoteClip("me", "g1_2_set");
    expect(count).toBe(1);
    const [, clipPayload] = cap.observed().update.mock.calls[0];
    expect(clipPayload).toEqual({ upvoteCount: 1 });
  });

  it("does not bump upvoteCount when the user has already upvoted (error path)", async () => {
    const cap = captureTxOnce(true);

    await expect(upvoteClip("me", "g1_2_set")).rejects.toBeInstanceOf(AlreadyUpvotedError);
    const tx = cap.observed();
    expect(tx.set).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("throws AlreadyUpvotedError when the vote doc already exists", async () => {
    captureTxOnce(true);
    await expect(upvoteClip("me", "g1_2_set")).rejects.toBeInstanceOf(AlreadyUpvotedError);
  });

  it("converts a permission-denied rejection into AlreadyUpvotedError", async () => {
    mockRunTransaction.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));

    await expect(upvoteClip("me", "g1_2_set")).rejects.toBeInstanceOf(AlreadyUpvotedError);
  });

  it("propagates unexpected transaction errors", async () => {
    mockRunTransaction.mockRejectedValueOnce(new Error("unavailable"));
    await expect(upvoteClip("me", "g1_2_set")).rejects.toThrow(/unavailable/);
  });
});

/* ── fetchClipUpvoteState ──────────────────────── */

describe("fetchClipUpvoteState", () => {
  function clip(
    id: string,
    upvoteCount: number,
    playerUid = "other",
  ): {
    id: string;
    upvoteCount: number;
    playerUid: string;
  } {
    return { id, upvoteCount, playerUid };
  }

  function voteSnap(voteIds: string[]) {
    return {
      docs: voteIds.map((vid) => ({
        id: vid,
        data: () => {
          // vote id is `${uid}_${clipId}` — strip the uid prefix to recover
          // the clip id stored on the doc body (mirrors upvoteClip's write).
          const sep = vid.indexOf("_");
          return { uid: vid.slice(0, sep), clipId: vid.slice(sep + 1) };
        },
      })),
    };
  }

  it("returns an empty Map when no clips are passed (no Firestore reads)", async () => {
    const map = await fetchClipUpvoteState("me", []);
    expect(map.size).toBe(0);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("seeds count from the denormalized clip aggregate and marks already-upvoted clips via a single batched query", async () => {
    // Single round-trip: one getDocs call with `where(__name__, in, [...])`
    // returning only the vote docs that exist for this viewer.
    mockGetDocs.mockResolvedValueOnce(voteSnap(["me_c1"])); // viewer upvoted c1, not c2/c3

    const map = await fetchClipUpvoteState("me", [clip("c1", 3), clip("c2", 0), clip("c3", 11)]);

    expect(mockGetDocs).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledWith({ __documentId: true }, "in", ["me_c1", "me_c2", "me_c3"]);

    expect(map.get("c1")).toEqual({ count: 3, alreadyUpvoted: true });
    expect(map.get("c2")).toEqual({ count: 0, alreadyUpvoted: false });
    expect(map.get("c3")).toEqual({ count: 11, alreadyUpvoted: false });
  });

  it("filters out the viewer's own clips before issuing any read (rule disallows self-upvote)", async () => {
    mockGetDocs.mockResolvedValueOnce(voteSnap([]));

    const map = await fetchClipUpvoteState("me", [clip("own", 5, "me"), clip("other", 9, "you")]);

    // Own clip never enters the result map — its count would be misleading
    // because the viewer can never upvote it. Hydration is skipped entirely.
    expect(map.has("own")).toBe(false);
    expect(map.get("other")).toEqual({ count: 9, alreadyUpvoted: false });
    // Only the non-self clip's vote id should be batched.
    expect(mockWhere).toHaveBeenCalledWith({ __documentId: true }, "in", ["me_other"]);
  });

  it("issues no reads when every supplied clip is owned by the viewer", async () => {
    const map = await fetchClipUpvoteState("me", [clip("a", 1, "me"), clip("b", 2, "me")]);
    expect(map.size).toBe(0);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("falls back to seeded {count, alreadyUpvoted=false} when the batched read fails (no per-clip blanking)", async () => {
    // Whole-batch failure: counts still come from the denormalized field
    // on the clip docs, so the UI continues to render accurate vote totals
    // even when the viewer's vote-doc lookup is rejected.
    mockGetDocs.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));

    const map = await fetchClipUpvoteState("me", [clip("c1", 4), clip("c2", 7)]);

    expect(map.get("c1")).toEqual({ count: 4, alreadyUpvoted: false });
    expect(map.get("c2")).toEqual({ count: 7, alreadyUpvoted: false });
  });

  it("ignores vote docs whose data.clipId is missing or non-string (defensive against malformed writes)", async () => {
    // A vote doc whose body lacks a string clipId is treated as if the
    // viewer hasn't voted that clip — we don't want to either crash or
    // silently mark a different clip as upvoted because the doc id parser
    // confused a malformed payload. Same path also covers a vote doc whose
    // clipId references something not in the requested set (legacy or
    // cross-call), which shouldn't poison the result map.
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        { id: "me_c1", data: () => ({ uid: "me", clipId: 42 }) }, // non-string clipId
        { id: "me_c2", data: () => ({ uid: "me" }) }, // missing clipId entirely
        { id: "me_unknown", data: () => ({ uid: "me", clipId: "unknown" }) }, // not in our request set
      ],
    });

    const map = await fetchClipUpvoteState("me", [clip("c1", 5), clip("c2", 8)]);

    // Both requested clips fall through to the seeded not-upvoted state
    // because the malformed vote docs above can't be safely attributed.
    expect(map.get("c1")).toEqual({ count: 5, alreadyUpvoted: false });
    expect(map.get("c2")).toEqual({ count: 8, alreadyUpvoted: false });
    // The unknown clip never gets injected into the result map.
    expect(map.has("unknown")).toBe(false);
  });

  it("chunks the in-query into batches of 30 to respect the Firestore in-cap", async () => {
    // 35 clips → 2 chunks (30 + 5). Each chunk fires its own getDocs.
    const clips = Array.from({ length: 35 }, (_, i) => clip(`c${i}`, i));
    mockGetDocs.mockResolvedValueOnce(voteSnap([])).mockResolvedValueOnce(voteSnap([]));

    const map = await fetchClipUpvoteState("me", clips);

    expect(mockGetDocs).toHaveBeenCalledTimes(2);
    // Spot-check: every clip got an entry, all default to not-upvoted.
    expect(map.size).toBe(35);
    expect(map.get("c34")).toEqual({ count: 34, alreadyUpvoted: false });
  });
});
