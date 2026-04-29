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
  mockGetCountFromServer,
  mockGetDoc,
  mockRunTransaction,
  mockIncrement,
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
    mockGetCountFromServer: vi.fn(),
    mockGetDoc: vi.fn(),
    mockRunTransaction: vi.fn(),
    mockIncrement: vi.fn((n: number) => ({ _op: "increment", operand: n })),
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
  getCountFromServer: mockGetCountFromServer,
  getDoc: mockGetDoc,
  runTransaction: mockRunTransaction,
  increment: mockIncrement,
  Timestamp: FakeTimestamp,
}));

vi.mock("../../firebase");

import {
  writeLandedClipsInTransaction,
  fetchClipsFeed,
  fetchRandomLandedClips,
  deleteUserClips,
  upvoteClip,
  fetchClipUpvoteState,
  AlreadyUpvotedError,
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
    ...overrides,
  };
}

describe("fetchClipsFeed", () => {
  it("queries active clips ordered by createdAt desc (with docId tiebreaker) and returns mapped docs", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        makeClipSnap("g1_2_set", validClipData()),
        makeClipSnap("g1_2_match", validClipData({ role: "match", playerUid: "p2", playerUsername: "bob" })),
      ],
    });

    const page = await fetchClipsFeed();

    // Feed must filter to active clips only so hidden-by-moderation content
    // never reaches users (App Store Guideline 1.2).
    expect(mockWhere).toHaveBeenCalledWith("moderationStatus", "==", "active");
    expect(mockOrderBy).toHaveBeenCalledWith("createdAt", "desc");
    expect(mockOrderBy).toHaveBeenCalledWith({ __documentId: true }, "desc");
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
    const page = await fetchClipsFeed();
    expect(page.clips[0].moderationStatus).toBe("active");
  });

  it("preserves 'hidden' moderationStatus when the backend surfaces one (defense in depth)", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("g1_2_set", validClipData({ moderationStatus: "hidden" }))],
    });
    const page = await fetchClipsFeed();
    expect(page.clips[0].moderationStatus).toBe("hidden");
  });

  it("applies the cursor via startAfter(createdAt, id) when provided", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    const cursor: ClipsFeedCursor = {
      createdAt: new FakeTimestamp(1_700_000_000_000) as unknown as ClipsFeedCursor["createdAt"],
      id: "g1_5_match",
    };
    const page = await fetchClipsFeed(cursor, 10);

    expect(mockStartAfter).toHaveBeenCalledWith(cursor.createdAt, cursor.id);
    expect(mockLimit).toHaveBeenCalledWith(10);
    expect(page.clips).toHaveLength(0);
    expect(page.cursor).toBeNull();
  });

  it("clamps pageSize into [1, 50]", async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });

    await fetchClipsFeed(null, 0);
    expect(mockLimit).toHaveBeenLastCalledWith(1);

    await fetchClipsFeed(null, 999);
    expect(mockLimit).toHaveBeenLastCalledWith(50);
  });

  it("returns a null cursor when the trailing doc has no createdAt", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("g1_2_set", validClipData({ createdAt: null }))],
    });

    const page = await fetchClipsFeed();

    expect(page.clips).toHaveLength(1);
    expect(page.clips[0].createdAt).toBeNull();
    expect(page.cursor).toBeNull();
  });

  it("coerces spotId to null when it's not a string", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("g1_2_set", validClipData({ spotId: undefined }))],
    });

    const page = await fetchClipsFeed();
    expect(page.clips[0].spotId).toBeNull();
  });

  it("filters out a doc with empty data instead of throwing the whole page away", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ id: "broken", data: () => undefined }, makeClipSnap("g1_2_set", validClipData())],
    });

    const page = await fetchClipsFeed();
    expect(page.clips).toHaveLength(1);
    expect(page.clips[0].id).toBe("g1_2_set");
  });

  it("filters out a doc with an invalid role", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("bad", validClipData({ role: "judge" })), makeClipSnap("g1_2_set", validClipData())],
    });

    const page = await fetchClipsFeed();
    expect(page.clips).toHaveLength(1);
    expect(page.clips[0].id).toBe("g1_2_set");
  });

  it("filters out docs with missing or wrong-typed required fields", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("bad", validClipData({ videoUrl: 42 })), makeClipSnap("g1_2_set", validClipData())],
    });

    const page = await fetchClipsFeed();
    expect(page.clips).toHaveLength(1);
    expect(page.clips[0].id).toBe("g1_2_set");
  });

  it("returns an empty clips array (not a throw) when the entire page is malformed", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ id: "broken", data: () => undefined }],
    });

    const page = await fetchClipsFeed();
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

    const page = await fetchClipsFeed();
    expect(page.clips).toHaveLength(1);
    expect(page.cursor).toEqual({ createdAt: trailingTs, id: "g1_3_set" });
  });

  it("accepts a createdAt that implements toMillis() but isn't a Timestamp instance", async () => {
    const duck = { toMillis: () => 1 };
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("g1_2_set", validClipData({ createdAt: duck }))],
    });

    const page = await fetchClipsFeed();
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

/* ── fetchRandomLandedClips ───────────────────── */

describe("fetchRandomLandedClips", () => {
  it("queries active clips, sorts by createdAt desc (with docId tiebreaker), limits to poolSize", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        makeClipSnap("a", validClipData({ trickName: "A" })),
        makeClipSnap("b", validClipData({ trickName: "B" })),
        makeClipSnap("c", validClipData({ trickName: "C" })),
      ],
    });

    const clips = await fetchRandomLandedClips(3, 60);

    expect(mockWhere).toHaveBeenCalledWith("moderationStatus", "==", "active");
    expect(mockOrderBy).toHaveBeenCalledWith("createdAt", "desc");
    expect(mockOrderBy).toHaveBeenCalledWith({ __documentId: true }, "desc");
    expect(mockLimit).toHaveBeenCalledWith(60);
    expect(clips).toHaveLength(3);
    // Set of trick names preserved; exact order depends on shuffle.
    expect(clips.map((c) => c.trickName).sort()).toEqual(["A", "B", "C"]);
  });

  it("Fisher-Yates shuffles the pool (with a deterministic Math.random)", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        makeClipSnap("a", validClipData({ trickName: "A" })),
        makeClipSnap("b", validClipData({ trickName: "B" })),
        makeClipSnap("c", validClipData({ trickName: "C" })),
      ],
    });

    // For n=3 the shuffle runs i=2 then i=1. With Math.random=0 both swaps
    // pick j=0: [A,B,C] → swap [0,2] → [C,B,A] → swap [0,1] → [B,C,A].
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const clips = await fetchRandomLandedClips(3, 60);
      expect(clips.map((c) => c.trickName)).toEqual(["B", "C", "A"]);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("returns only `sampleSize` clips even when the pool is larger", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: Array.from({ length: 10 }, (_, i) => makeClipSnap(`id${i}`, validClipData({ trickName: `T${i}` }))),
    });

    const clips = await fetchRandomLandedClips(4, 10);
    expect(clips).toHaveLength(4);
  });

  it("clamps sampleSize to [1, 50] and poolSize to [sampleSize, 200]", async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });

    // sampleSize=0 → clamped to 1; poolSize=500 → clamped to 200.
    await fetchRandomLandedClips(0, 500);
    expect(mockLimit).toHaveBeenLastCalledWith(200);

    // sampleSize=999 → clamped to 50; poolSize=5 (< sampleSize) → 50.
    await fetchRandomLandedClips(999, 5);
    expect(mockLimit).toHaveBeenLastCalledWith(50);
  });

  it("skips malformed docs rather than throwing the whole page away", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("ok", validClipData()), { id: "broken", data: () => undefined }],
    });

    const clips = await fetchRandomLandedClips(5, 10);
    expect(clips).toHaveLength(1);
    expect(clips[0].id).toBe("ok");
  });

  it("returns an empty array when the collection has no active clips", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    const clips = await fetchRandomLandedClips(12, 60);
    expect(clips).toEqual([]);
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

function countSnap(count: number) {
  return { data: () => ({ count }) };
}

describe("upvoteClip", () => {
  it("writes the vote inside a transaction and returns the refreshed count", async () => {
    mockRunTransaction.mockImplementationOnce(async (_db: unknown, cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        get: vi.fn().mockResolvedValue({ exists: () => false }),
        set: vi.fn(),
        update: vi.fn(),
      };
      await cb(tx);
      return tx;
    });
    mockGetCountFromServer.mockResolvedValueOnce(countSnap(7));

    const count = await upvoteClip("me", "g1_2_set");

    expect(count).toBe(7);
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "clipVotes", "me_g1_2_set");
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "clips", "g1_2_set");
  });

  it("atomically increments upvoteCount on the clip in the same transaction as the vote write", async () => {
    let observedTx:
      | undefined
      | {
          set: ReturnType<typeof vi.fn>;
          update: ReturnType<typeof vi.fn>;
          get: ReturnType<typeof vi.fn>;
        };

    mockRunTransaction.mockImplementationOnce(async (_db: unknown, cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        get: vi.fn().mockResolvedValue({ exists: () => false }),
        set: vi.fn(),
        update: vi.fn(),
      };
      observedTx = tx;
      await cb(tx);
    });
    mockGetCountFromServer.mockResolvedValueOnce(countSnap(1));

    await upvoteClip("me", "g1_2_set");

    // Both writes must land on the same Transaction object — that's what
    // makes the aggregate consistent with the votes underneath.
    expect(observedTx).toBeDefined();
    expect(observedTx!.set).toHaveBeenCalledTimes(1);
    expect(observedTx!.update).toHaveBeenCalledTimes(1);

    const [voteRef, votePayload] = observedTx!.set.mock.calls[0];
    expect((voteRef as { __path: string }).__path).toBe("clipVotes/me_g1_2_set");
    expect(votePayload).toMatchObject({ uid: "me", clipId: "g1_2_set" });

    const [clipRef, clipPayload] = observedTx!.update.mock.calls[0];
    expect((clipRef as { __path: string }).__path).toBe("clips/g1_2_set");
    expect(clipPayload).toEqual({ upvoteCount: { _op: "increment", operand: 1 } });
    expect(mockIncrement).toHaveBeenCalledWith(1);
  });

  it("does not bump upvoteCount when the user has already upvoted (error path)", async () => {
    let observedTx:
      | undefined
      | {
          set: ReturnType<typeof vi.fn>;
          update: ReturnType<typeof vi.fn>;
          get: ReturnType<typeof vi.fn>;
        };

    mockRunTransaction.mockImplementationOnce(async (_db: unknown, cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        get: vi.fn().mockResolvedValue({ exists: () => true }),
        set: vi.fn(),
        update: vi.fn(),
      };
      observedTx = tx;
      await cb(tx);
    });

    await expect(upvoteClip("me", "g1_2_set")).rejects.toBeInstanceOf(AlreadyUpvotedError);
    expect(observedTx!.set).not.toHaveBeenCalled();
    expect(observedTx!.update).not.toHaveBeenCalled();
  });

  it("throws AlreadyUpvotedError when the vote doc already exists", async () => {
    mockRunTransaction.mockImplementationOnce(async (_db: unknown, cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        get: vi.fn().mockResolvedValue({ exists: () => true }),
        set: vi.fn(),
        update: vi.fn(),
      };
      await cb(tx);
    });

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
  it("returns an empty Map when no clip ids are passed (no Firestore reads)", async () => {
    const map = await fetchClipUpvoteState("me", []);
    expect(map.size).toBe(0);
    expect(mockGetCountFromServer).not.toHaveBeenCalled();
    expect(mockGetDoc).not.toHaveBeenCalled();
  });

  it("stitches per-clip count + alreadyUpvoted into a Map keyed by clip id", async () => {
    // Mocks resolve in definition order — match the (count, alreadyUpvoted)
    // pair structure for each id by interleaving the two mock streams.
    mockGetCountFromServer
      .mockResolvedValueOnce(countSnap(3))
      .mockResolvedValueOnce(countSnap(0))
      .mockResolvedValueOnce(countSnap(11));
    mockGetDoc
      .mockResolvedValueOnce({ exists: () => true })
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => false });

    const map = await fetchClipUpvoteState("me", ["c1", "c2", "c3"]);

    expect(map.get("c1")).toEqual({ count: 3, alreadyUpvoted: true });
    expect(map.get("c2")).toEqual({ count: 0, alreadyUpvoted: false });
    expect(map.get("c3")).toEqual({ count: 11, alreadyUpvoted: false });
  });

  it("defaults a clip's state to {0,false} when its count read fails (other clips unaffected)", async () => {
    // First clip's count fails (with a permanent code so withRetry doesn't loop);
    // second clip succeeds. countClipUpvotes already swallows internally and
    // returns 0, so the failing clip should still appear with default state.
    mockGetCountFromServer
      .mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }))
      .mockResolvedValueOnce(countSnap(5));
    mockGetDoc.mockResolvedValueOnce({ exists: () => false }).mockResolvedValueOnce({ exists: () => true });

    const map = await fetchClipUpvoteState("me", ["broken", "ok"]);

    expect(map.get("broken")).toEqual({ count: 0, alreadyUpvoted: false });
    expect(map.get("ok")).toEqual({ count: 5, alreadyUpvoted: true });
  });

  it("defaults to {0,false} when the vote-doc check fails", async () => {
    mockGetCountFromServer.mockResolvedValueOnce(countSnap(2));
    mockGetDoc.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));

    const map = await fetchClipUpvoteState("me", ["c1"]);
    expect(map.get("c1")).toEqual({ count: 2, alreadyUpvoted: false });
  });
});
