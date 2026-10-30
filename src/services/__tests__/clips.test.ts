import { describe, it, expect, vi, beforeEach, onTestFinished } from "vitest";

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

// The clips modules pull the storage SDK into this module graph; stubbed at
// the SDK boundary rather than mocking ../storage.
const { mockStorageRef, mockDeleteObject } = vi.hoisted(() => ({
  mockStorageRef: vi.fn((_storage: unknown, path: string) => ({ __path: path })),
  mockDeleteObject: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("firebase/storage", () => ({
  ref: mockStorageRef,
  uploadBytesResumable: vi.fn(),
  getDownloadURL: vi.fn(),
  deleteObject: mockDeleteObject,
  listAll: vi.fn(),
}));

vi.mock("../../firebase");

import {
  writeLandedClipsInTransaction,
  fetchClipsFeed,
  castClipVote,
  removeClipVote,
  fetchClipVoteState,
  _resetTopIndexCircuitBreaker,
  type LandedClipContext,
  type ClipsFeedCursor,
} from "../clips";
import { toClipDoc } from "../clips.mappers";
import { AlreadyVotedError, NotVotedError, SelfVoteError } from "../clips.votes";
// Not mocked: the orphan-cleanup path logs through the real logger, so the
// test spies on the exported object to assert the event name it emits.
import { logger } from "../logger";

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
  // Fallback for reads a test doesn't explicitly wire. `mockResolvedValueOnce`
  // queues ahead of this, so tests that do wire a read are unaffected.
  mockGetDocs.mockResolvedValue({ docs: [] });
  mockDeleteObject.mockResolvedValue(undefined);
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
      source: "game",
      downvoteCount: 0,
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
      source: "game",
      downvoteCount: 0,
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

  it("drops a hidden or non-approved clip if one slips past the query", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        makeClipSnap("hidden", validClipData({ moderationStatus: "hidden" })),
        makeClipSnap("review", validClipData({ moderationStatus: "active", moderation: "review" })),
        makeClipSnap("ok", validClipData({ moderationStatus: "active", moderation: "approved" })),
      ],
    });
    const page = await fetchClipsFeed(null, 20, "new");
    expect(page.clips.map((clip) => clip.id)).toEqual(["ok"]);
  });

  it("preserves pending and ignores an unknown moderation value", () => {
    const pending = toClipDoc({
      id: "c1",
      data: () =>
        validClipData({
          source: "user",
          gameId: null,
          turnNumber: null,
          role: null,
          moderationStatus: "pending",
          moderation: "pending",
        }),
    } as never);
    expect(pending).toMatchObject({ source: "user", moderationStatus: "pending", moderation: "pending" });

    const unknown = toClipDoc({
      id: "c2",
      data: () => validClipData({ moderation: "nope" }),
    } as never);
    expect(unknown.moderation).toBeNull();
    expect(unknown.moderationStatus).toBe("active");

    for (const moderation of ["approved", "review", "rejected", "removed"] as const) {
      const clip = toClipDoc({
        id: moderation,
        data: () => validClipData({ moderation }),
      } as never);
      expect(clip.moderation).toBe(moderation);
    }
  });

  it("keeps a pending moderationStatus from being read as active", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("pending", validClipData({ moderationStatus: "pending", moderation: "pending" }))],
    });
    const page = await fetchClipsFeed(null, 20, "new");
    expect(page.clips).toEqual([]);
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

/* ── castClipVote (upvote) ─────────────────────── */

describe("castClipVote (upvote)", () => {
  type ObservedTx = {
    set: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };

  /**
   * Wires `mockRunTransaction` to capture and return the Transaction stub
   * the service body sees. The service issues two `tx.get` calls — one for
   * the vote doc (drives the AlreadyVotedError branch) and one for the
   * clip doc (drives the post-tx return count). The mock differentiates by
   * the ref's `__path` prefix produced by the firestore mockDoc helper.
   */
  function captureTxOnce(
    voteExists: boolean,
    currentUpvoteCount: number | "no-clip-doc" | "non-numeric" = 0,
    clipOwnerUid?: string,
  ): { observed: () => ObservedTx } {
    let captured: ObservedTx | undefined;
    mockRunTransaction.mockImplementationOnce(async (_db: unknown, cb: (tx: unknown) => Promise<void>) => {
      const tx: ObservedTx = {
        get: vi.fn().mockImplementation(async (ref: { __path?: string }) => {
          const path = ref.__path ?? "";
          if (path.startsWith("clipVotes/")) {
            // Legacy-shaped vote body (no `value`): the service reads that
            // as an upvote, which is exactly what these upvote-path cases
            // are asserting.
            return { exists: () => voteExists, data: () => ({}) };
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
              return { exists: () => true, data: () => ({ upvoteCount: "broken", playerUid: clipOwnerUid }) };
            }
            return {
              exists: () => true,
              data: () => ({ upvoteCount: currentUpvoteCount, playerUid: clipOwnerUid }),
            };
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

    const { upvoteCount: count } = await castClipVote("me", "g1_2_set", 1);

    // Returned count is current+1, derived from the in-transaction read —
    // no follow-up aggregate query was needed.
    expect(count).toBe(7);
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "clipVotes", "me_g1_2_set");
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "clips", "g1_2_set");
  });

  it("writes the literal post-increment count to the clip aggregate (not increment(1))", async () => {
    const cap = captureTxOnce(false, 1);

    await castClipVote("me", "g1_2_set", 1);

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
    ({ upvoteCount: count } = await castClipVote("me", "g1_2_set", 1));
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
    const { upvoteCount: count } = await castClipVote("me", "g1_2_set", 1);
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
    const { upvoteCount: count } = await castClipVote("me", "g1_2_set", 1);
    expect(count).toBe(1);
    const [, clipPayload] = cap.observed().update.mock.calls[0];
    expect(clipPayload).toEqual({ upvoteCount: 1 });
  });

  it("does not bump upvoteCount when the user has already upvoted (error path)", async () => {
    const cap = captureTxOnce(true);

    await expect(castClipVote("me", "g1_2_set", 1)).rejects.toBeInstanceOf(AlreadyVotedError);
    const tx = cap.observed();
    expect(tx.set).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("throws AlreadyVotedError when the vote doc already exists", async () => {
    captureTxOnce(true);
    await expect(castClipVote("me", "g1_2_set", 1)).rejects.toBeInstanceOf(AlreadyVotedError);
  });

  it("converts a permission-denied rejection into AlreadyVotedError", async () => {
    mockRunTransaction.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));

    await expect(castClipVote("me", "g1_2_set", 1)).rejects.toBeInstanceOf(AlreadyVotedError);
  });

  it("throws SelfVoteError without writing when the caller owns the clip", async () => {
    // The clipVotes create rule does NOT reject a vote on your own clip, so
    // this service guard is the canonical block against inflating your own
    // count. The clip doc's playerUid matches the upvoter here.
    const cap = captureTxOnce(false, 3, "me");

    await expect(castClipVote("me", "g1_2_set", 1)).rejects.toBeInstanceOf(SelfVoteError);

    // No vote doc, no count bump — the guard fires before either write.
    const tx = cap.observed();
    expect(tx.set).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("re-throws SelfVoteError verbatim rather than masking it as AlreadyVotedError", async () => {
    // The catch block must let SelfVoteError pass through untouched — a
    // self-upvote is a distinct business state from a duplicate upvote.
    captureTxOnce(false, 0, "me");
    await expect(castClipVote("me", "g1_2_set", 1)).rejects.toThrow(/^self_vote:g1_2_set$/);
  });

  it("propagates unexpected transaction errors", async () => {
    mockRunTransaction.mockRejectedValueOnce(new Error("unavailable"));
    await expect(castClipVote("me", "g1_2_set", 1)).rejects.toThrow(/unavailable/);
  });
});

/* ── fetchClipVoteState ────────────────────────── */

describe("fetchClipVoteState", () => {
  function clip(
    id: string,
    upvoteCount: number,
    playerUid = "other",
  ): {
    id: string;
    upvoteCount: number;
    downvoteCount: number;
    playerUid: string;
  } {
    return { id, upvoteCount, downvoteCount: 0, playerUid };
  }

  function voteSnap(voteIds: string[]) {
    return {
      docs: voteIds.map((vid) => ({
        id: vid,
        data: () => {
          // vote id is `${uid}_${clipId}` — strip the uid prefix to recover
          // the clip id stored on the doc body (mirrors castClipVote's write).
          const sep = vid.indexOf("_");
          return { uid: vid.slice(0, sep), clipId: vid.slice(sep + 1) };
        },
      })),
    };
  }

  it("returns an empty Map when no clips are passed (no Firestore reads)", async () => {
    const map = await fetchClipVoteState("me", []);
    expect(map.size).toBe(0);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("seeds count from the denormalized clip aggregate and marks already-upvoted clips via a single batched query", async () => {
    // Single round-trip: one getDocs call with `where(__name__, in, [...])`
    // returning only the vote docs that exist for this viewer.
    mockGetDocs.mockResolvedValueOnce(voteSnap(["me_c1"])); // viewer upvoted c1, not c2/c3

    const map = await fetchClipVoteState("me", [clip("c1", 3), clip("c2", 0), clip("c3", 11)]);

    expect(mockGetDocs).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledWith({ __documentId: true }, "in", ["me_c1", "me_c2", "me_c3"]);

    expect(map.get("c1")).toEqual({ upvoteCount: 3, downvoteCount: 0, myVote: 1 });
    expect(map.get("c2")).toEqual({ upvoteCount: 0, downvoteCount: 0, myVote: null });
    expect(map.get("c3")).toEqual({ upvoteCount: 11, downvoteCount: 0, myVote: null });
  });

  it("filters out the viewer's own clips before issuing any read (rule disallows self-upvote)", async () => {
    mockGetDocs.mockResolvedValueOnce(voteSnap([]));

    const map = await fetchClipVoteState("me", [clip("own", 5, "me"), clip("other", 9, "you")]);

    // Own clip never enters the result map — its count would be misleading
    // because the viewer can never upvote it. Hydration is skipped entirely.
    expect(map.has("own")).toBe(false);
    expect(map.get("other")).toEqual({ upvoteCount: 9, downvoteCount: 0, myVote: null });
    // Only the non-self clip's vote id should be batched.
    expect(mockWhere).toHaveBeenCalledWith({ __documentId: true }, "in", ["me_other"]);
  });

  it("issues no reads when every supplied clip is owned by the viewer", async () => {
    const map = await fetchClipVoteState("me", [clip("a", 1, "me"), clip("b", 2, "me")]);
    expect(map.size).toBe(0);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("falls back to the seeded counts with myVote=null when the batched read fails (no per-clip blanking)", async () => {
    // Whole-batch failure: counts still come from the denormalized field
    // on the clip docs, so the UI continues to render accurate vote totals
    // even when the viewer's vote-doc lookup is rejected.
    mockGetDocs.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));

    const map = await fetchClipVoteState("me", [clip("c1", 4), clip("c2", 7)]);

    expect(map.get("c1")).toEqual({ upvoteCount: 4, downvoteCount: 0, myVote: null });
    expect(map.get("c2")).toEqual({ upvoteCount: 7, downvoteCount: 0, myVote: null });
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

    const map = await fetchClipVoteState("me", [clip("c1", 5), clip("c2", 8)]);

    // Both requested clips fall through to the seeded not-upvoted state
    // because the malformed vote docs above can't be safely attributed.
    expect(map.get("c1")).toEqual({ upvoteCount: 5, downvoteCount: 0, myVote: null });
    expect(map.get("c2")).toEqual({ upvoteCount: 8, downvoteCount: 0, myVote: null });
    // The unknown clip never gets injected into the result map.
    expect(map.has("unknown")).toBe(false);
  });

  it("chunks the in-query into batches of 30 to respect the Firestore in-cap", async () => {
    // 35 clips → 2 chunks (30 + 5). Each chunk fires its own getDocs.
    const clips = Array.from({ length: 35 }, (_, i) => clip(`c${i}`, i));
    mockGetDocs.mockResolvedValueOnce(voteSnap([])).mockResolvedValueOnce(voteSnap([]));

    const map = await fetchClipVoteState("me", clips);

    expect(mockGetDocs).toHaveBeenCalledTimes(2);
    // Spot-check: every clip got an entry, all default to not-upvoted.
    expect(map.size).toBe(35);
    expect(map.get("c34")).toEqual({ upvoteCount: 34, downvoteCount: 0, myVote: null });
  });
});

/* ── removeClipVote ────────────────────────────── */

describe("removeClipVote", () => {
  type RemoveTx = {
    get: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  /**
   * On-disk state of the clip doc as the in-transaction read sees it.
   * "missing" models a clip deleted out from under a live vote; the object
   * form models a live doc carrying whatever `upvoteCount` value happens to
   * be stored — including drifted or corrupt ones.
   */
  type ClipDisk = "missing" | { upvoteCount?: unknown };

  /** Per-attempt view of the two docs the transaction reads together. */
  type Attempt = { vote: boolean; clip: ClipDisk };

  /**
   * Drive `mockRunTransaction` for removeClipVote. The service reads the vote
   * doc and the clip doc in one `Promise.all`, so the stub answers by the
   * ref's `__path` prefix (produced by the firestore mockDoc helper).
   *
   * Passing more than one attempt replays the callback the way the real
   * `runTransaction` does under contention: each replay gets a fresh tx stub
   * and may observe different disk state. That is what makes the
   * per-attempt `orphanedVote` reset observable.
   */
  function wireTx(attempts: ReadonlyArray<Attempt>): { txs: () => RemoveTx[] } {
    const seen: RemoveTx[] = [];
    mockRunTransaction.mockImplementationOnce(async (_db: unknown, cb: (tx: unknown) => Promise<void>) => {
      for (const attempt of attempts) {
        const tx: RemoveTx = {
          get: vi.fn().mockImplementation(async (ref: { __path?: string }) => {
            const path = ref.__path ?? "";
            if (path.startsWith("clipVotes/")) return { exists: () => attempt.vote, data: () => ({ value: 1 }) };
            if (path.startsWith("clips/")) {
              const disk = attempt.clip;
              if (disk === "missing") return { exists: () => false };
              return { exists: () => true, data: () => disk };
            }
            throw new Error(`Unexpected ref path in tx.get: ${path}`);
          }),
          delete: vi.fn(),
          update: vi.fn(),
        };
        seen.push(tx);
        await cb(tx);
      }
    });
    return { txs: () => seen };
  }

  /** Single-attempt shorthand — the uncontended case every test but one uses. */
  function wireAttempt(vote: boolean, clip: ClipDisk): { txs: () => RemoveTx[] } {
    return wireTx([{ vote, clip }]);
  }

  it("deletes the vote and writes the decremented literal count in the same transaction", async () => {
    const cap = wireTx([{ vote: true, clip: { upvoteCount: 5 } }]);

    const { upvoteCount: count } = await removeClipVote("me", "g1_2_set");

    // Post-write count comes from the in-tx read — no follow-up aggregate query.
    expect(count).toBe(4);
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "clipVotes", "me_g1_2_set");
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "clips", "g1_2_set");

    const [tx] = cap.txs();
    expect((tx.delete.mock.calls[0][0] as { __path: string }).__path).toBe("clipVotes/me_g1_2_set");
    // Literal (not increment(-1)) — the shape the -1 branch of the clips rule
    // matches, paired with the vote doc no longer existing after the write.
    expect(tx.update).toHaveBeenCalledWith({ __path: "clips/g1_2_set", id: "g1_2_set" }, { upvoteCount: 4 });
    // The vote is removed inside the transaction; no out-of-band delete.
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it("takes the count to exactly 0 when withdrawing the clip's only upvote", async () => {
    // Boundary between the decrement path and the drift path: current = 1 is
    // the smallest value that may still be decremented legally.
    const cap = wireAttempt(true, { upvoteCount: 1 });

    await expect(removeClipVote("me", "g1_2_set")).resolves.toMatchObject({ upvoteCount: 0 });

    const [tx] = cap.txs();
    expect(tx.update).toHaveBeenCalledWith(expect.anything(), { upvoteCount: 0 });
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it("throws NotVotedError without writing anything when the caller has no vote", async () => {
    const cap = wireAttempt(false, { upvoteCount: 4 });

    const err: unknown = await removeClipVote("me", "g1_2_set").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotVotedError);
    // Callers key off the clipId to advance the feed past the un-upvoted clip.
    expect((err as NotVotedError).clipId).toBe("g1_2_set");
    expect((err as Error).message).toBe("not_voted:g1_2_set");

    const [tx] = cap.txs();
    expect(tx.delete).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it.each<{ label: string; clip: ClipDisk }>([
    { label: "already at the 0 floor", clip: { upvoteCount: 0 } },
    { label: "drifted negative", clip: { upvoteCount: -3 } },
    { label: "non-numeric", clip: { upvoteCount: "broken" } },
    { label: "NaN", clip: { upvoteCount: NaN } },
    { label: "absent (legacy pre-backfill clip)", clip: {} },
    { label: "unreadable because the clip doc is gone", clip: "missing" },
  ])("returns 0 and cleans the vote up after the transaction when the count is $label", async ({ clip }) => {
    const cap = wireAttempt(true, clip);

    await expect(removeClipVote("me", "g1_2_set")).resolves.toMatchObject({ upvoteCount: 0 });

    // Nothing inside the transaction: a -1 write would be rejected by the
    // rule's `upvoteCount >= 0` guard and strand the vote doc forever.
    const [tx] = cap.txs();
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
    // The stranded vote is dropped on its own — permitted by the owner-only
    // clipVotes delete rule — leaving the count at its correct floor.
    expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
    expect((mockDeleteDoc.mock.calls[0][0] as { __path: string }).__path).toBe("clipVotes/me_g1_2_set");
  });

  it("still resolves 0 and logs when the out-of-band vote cleanup is rejected", async () => {
    // Best-effort cleanup: the count is already at its floor, so a failed
    // delete leaves the UI correct and merely keeps a stale vote doc around.
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    mockDeleteDoc.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));
    wireAttempt(true, { upvoteCount: 0 });

    await expect(removeClipVote("me", "g1_2_set")).resolves.toMatchObject({ upvoteCount: 0 });

    expect(warn).toHaveBeenCalledWith(
      "clip_vote_orphan_delete_failed",
      expect.objectContaining({ clipId: "g1_2_set" }),
    );
  });

  it("re-evaluates the orphan flag on each transaction attempt (contention replay)", async () => {
    // runTransaction replays its callback when the read set is contended.
    // Attempt 1 sees a drifted 0 count (orphan path); the retry sees the
    // healthy count written by whoever won the race. A stale orphan flag
    // leaking across attempts would delete a vote doc that the successful
    // attempt already removed transactionally — and would do it after a
    // legitimate decrement, silently dropping a live vote.
    const cap = wireTx([
      { vote: true, clip: { upvoteCount: 0 } },
      { vote: true, clip: { upvoteCount: 2 } },
    ]);

    await expect(removeClipVote("me", "g1_2_set")).resolves.toMatchObject({ upvoteCount: 1 });

    const [, retry] = cap.txs();
    expect(retry.delete).toHaveBeenCalledTimes(1);
    expect(retry.update).toHaveBeenCalledWith(expect.anything(), { upvoteCount: 1 });
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });
});

/* ── toClipDoc: the source discriminant ─────────────────────── */

describe("toClipDoc source variants (via fetchClipsFeed)", () => {
  it("maps a user-source clip with null game coordinates instead of throwing", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        makeClipSnap("user-clip-1", {
          source: "user",
          gameId: null,
          turnNumber: null,
          role: null,
          playerUid: "p9",
          playerUsername: "casey",
          trickName: "nollie heel",
          videoUrl: "https://example.com/u.webm",
          spotId: null,
          createdAt: new FakeTimestamp(1_700_000_000_000),
          moderationStatus: "active",
          upvoteCount: 3,
          downvoteCount: 1,
        }),
      ],
    });

    const page = await fetchClipsFeed(null, 20, "new");

    expect(page.clips).toHaveLength(1);
    expect(page.clips[0]).toMatchObject({
      id: "user-clip-1",
      source: "user",
      gameId: null,
      turnNumber: null,
      role: null,
      upvoteCount: 3,
      downvoteCount: 1,
    });
  });

  it("defaults a legacy doc with no `source` to 'game' and its counts to 0", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("legacy-1", validClipData({ upvoteCount: undefined, downvoteCount: undefined }))],
    });

    const page = await fetchClipsFeed(null, 20, "new");

    expect(page.clips[0]).toMatchObject({ source: "game", upvoteCount: 0, downvoteCount: 0, gameId: "g1" });
  });

  it("still drops a game-source doc missing its game coordinates", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        makeClipSnap("broken-1", validClipData({ gameId: undefined })),
        makeClipSnap("broken-2", validClipData({ role: undefined })),
        makeClipSnap("broken-3", validClipData({ playerUid: undefined })),
        makeClipSnap("ok-1", validClipData()),
      ],
    });

    const page = await fetchClipsFeed(null, 20, "new");

    // One bad doc must not blank the page — only the malformed ones drop.
    expect(page.clips.map((c) => c.id)).toEqual(["ok-1"]);
  });

  it("reads a negative or non-numeric count as 0 rather than propagating it", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("drift-1", validClipData({ upvoteCount: -4, downvoteCount: "lots" }))],
    });

    const page = await fetchClipsFeed(null, 20, "new");

    expect(page.clips[0]).toMatchObject({ upvoteCount: 0, downvoteCount: 0 });
  });
});
