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
  Timestamp: FakeTimestamp,
}));

vi.mock("../../firebase");

import {
  writeLandedClipsInTransaction,
  fetchClipsFeed,
  deleteUserClips,
  type LandedClipContext,
  type ClipsFeedCursor,
} from "../clips";

/* ── Helpers ────────────────────────────────── */

function makeTx() {
  return { set: vi.fn(), update: vi.fn(), get: vi.fn() };
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
    });

    const [, matchPayload] = tx.set.mock.calls[1];
    expect(matchPayload).toMatchObject({
      role: "match",
      playerUid: "p2",
      playerUsername: "bob",
      videoUrl: "https://example.com/match.webm",
      createdAt: "SERVER_TS",
      moderationStatus: "active",
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

  it("throws on a doc with empty data", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ id: "broken", data: () => undefined }],
    });

    await expect(fetchClipsFeed()).rejects.toThrow(/Malformed clip document: broken/);
  });

  it("throws on an invalid role", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("bad", validClipData({ role: "judge" }))],
    });

    await expect(fetchClipsFeed()).rejects.toThrow(/role/);
  });

  it("throws when required fields are missing or wrong types", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("bad", validClipData({ videoUrl: 42 }))],
    });

    await expect(fetchClipsFeed()).rejects.toThrow(/fields/);
  });

  it("accepts a createdAt that implements toMillis() but isn't a Timestamp instance", async () => {
    const duck = { toMillis: () => 1 };
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeClipSnap("g1_2_set", validClipData({ createdAt: duck }))],
    });

    const page = await fetchClipsFeed();
    expect(page.clips[0].createdAt).toBe(duck);
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
    const deletedIds = mockDeleteDoc.mock.calls.map(([ref]: [{ id: string }]) => ref.id);
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
