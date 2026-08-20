/**
 * Clip comments — `src/services/clips.comments.ts`.
 *
 * The firestore mock is local rather than the shared `firestoreDoc` harness
 * because this module needs `addDoc`, `startAfter` and `limit`, which that
 * harness deliberately doesn't install.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockAddDoc,
  mockCollection,
  mockDeleteDoc,
  mockDoc,
  mockGetDocs,
  mockLimit,
  mockOrderBy,
  mockQuery,
  mockServerTimestamp,
  mockStartAfter,
} = vi.hoisted(() => ({
  mockAddDoc: vi.fn().mockResolvedValue({ id: "new-comment" }),
  mockCollection: vi.fn((_db: unknown, ...path: string[]) => ({ __collection: path.join("/") })),
  mockDeleteDoc: vi.fn().mockResolvedValue(undefined),
  mockDoc: vi.fn((_db: unknown, ...path: string[]) => ({ __path: path.join("/") })),
  mockGetDocs: vi.fn().mockResolvedValue({ docs: [] }),
  mockLimit: vi.fn((n: number) => ({ __limit: n })),
  mockOrderBy: vi.fn((field: unknown, dir: unknown) => ({ __orderBy: { field, dir } })),
  mockQuery: vi.fn((...args: unknown[]) => ({ __query: args })),
  mockServerTimestamp: vi.fn(() => "SERVER_TS"),
  mockStartAfter: vi.fn((...values: unknown[]) => ({ __startAfter: values })),
}));

/**
 * Timestamp double. The mapper prefers `instanceof Timestamp` and falls back
 * to duck-typing on `toMillis`, so a bare object exercises the fallback that
 * every non-SDK caller (and every emulator-free test) actually hits.
 */
function ts(ms: number): { toMillis: () => number } {
  return { toMillis: () => ms };
}

vi.mock("firebase/firestore", () => ({
  addDoc: mockAddDoc,
  collection: mockCollection,
  deleteDoc: mockDeleteDoc,
  doc: mockDoc,
  getDocs: mockGetDocs,
  limit: mockLimit,
  orderBy: mockOrderBy,
  query: mockQuery,
  serverTimestamp: mockServerTimestamp,
  startAfter: mockStartAfter,
  // The suite never constructs a real Timestamp; this only satisfies the
  // value import in the module under test.
  Timestamp: class {},
}));

vi.mock("../../firebase");

import {
  CLIP_COMMENT_MAX_LENGTH,
  createClipComment,
  deleteClipComment,
  fetchClipComments,
  toClipComment,
  type ClipCommentsCursor,
} from "../clips.comments";
import { logger } from "../logger";
import { Timestamp } from "firebase/firestore";

function commentSnap(id: string, data: Record<string, unknown> | undefined) {
  return { id, data: () => data } as unknown as import("firebase/firestore").DocumentSnapshot;
}

function validComment(overrides: Record<string, unknown> = {}) {
  return {
    userId: "p1",
    username: "alice",
    text: "sick",
    createdAt: ts(1_700_000_000_000),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAddDoc.mockResolvedValue({ id: "new-comment" });
  mockGetDocs.mockResolvedValue({ docs: [] });
  mockDeleteDoc.mockResolvedValue(undefined);
});

/* ── createClipComment ──────────────────────────────────────── */

describe("createClipComment", () => {
  it("writes the trimmed body to the clip's comments subcollection", async () => {
    const created = await createClipComment("p1", "alice", "uc1", "  sick landing  ");

    expect(mockCollection).toHaveBeenCalledWith(expect.anything(), "clips", "uc1", "comments");
    expect(mockAddDoc).toHaveBeenCalledWith(expect.anything(), {
      userId: "p1",
      username: "alice",
      text: "sick landing",
      createdAt: "SERVER_TS",
    });
    // createdAt is null until the server resolves the sentinel — the caller
    // appends optimistically rather than paying a read to learn it.
    expect(created).toEqual({
      id: "new-comment",
      clipId: "uc1",
      userId: "p1",
      username: "alice",
      text: "sick landing",
      createdAt: null,
    });
  });

  it("rejects a whitespace-only comment before touching the network", async () => {
    await expect(createClipComment("p1", "alice", "uc1", "   ")).rejects.toThrow(/Write something/);
    expect(mockAddDoc).not.toHaveBeenCalled();
  });

  it("rejects a comment over the length cap", async () => {
    const tooLong = "x".repeat(CLIP_COMMENT_MAX_LENGTH + 1);

    await expect(createClipComment("p1", "alice", "uc1", tooLong)).rejects.toThrow(/300 characters/);
    expect(mockAddDoc).not.toHaveBeenCalled();
  });

  it("accepts a comment of exactly the cap", async () => {
    await expect(createClipComment("p1", "alice", "uc1", "x".repeat(CLIP_COMMENT_MAX_LENGTH))).resolves.toMatchObject({
      id: "new-comment",
    });
  });

  it("rejects unusable path segments", async () => {
    await expect(createClipComment("p1", "alice", "", "hi")).rejects.toThrow(/Invalid clip id/);
    await expect(createClipComment("p1", "alice", "a/b", "hi")).rejects.toThrow(/Invalid clip id/);
    await expect(createClipComment("", "alice", "uc1", "hi")).rejects.toThrow(/Invalid user id/);
    expect(mockAddDoc).not.toHaveBeenCalled();
  });

  it("stores an empty username rather than the literal undefined", async () => {
    await createClipComment("p1", undefined as unknown as string, "uc1", "hi");

    expect(mockAddDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ username: "" }));
  });

  it("converts a write failure into a user-facing message and logs the cause", async () => {
    mockAddDoc.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(createClipComment("p1", "alice", "uc1", "hi")).rejects.toThrow(/Failed to post comment/);

    expect(warn).toHaveBeenCalledWith("clip_comment_create_failed", expect.objectContaining({ clipId: "uc1" }));
    warn.mockRestore();
  });

  it("coerces a non-string body to empty and rejects it", async () => {
    await expect(createClipComment("p1", "alice", "uc1", null as unknown as string)).rejects.toThrow(/Write something/);
  });
});

/* ── deleteClipComment ──────────────────────────────────────── */

describe("deleteClipComment", () => {
  it("deletes the addressed comment doc", async () => {
    await deleteClipComment("p1", "uc1", "c9");

    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "clips", "uc1", "comments", "c9");
    expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
  });

  it("rejects unusable path segments without a write", async () => {
    await expect(deleteClipComment("", "uc1", "c9")).rejects.toThrow(/Invalid user id/);
    await expect(deleteClipComment("p1", "", "c9")).rejects.toThrow(/Invalid clip id/);
    await expect(deleteClipComment("p1", "uc1", "a/b")).rejects.toThrow(/Invalid comment id/);
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it("rethrows and logs a rejected delete so the UI can surface it", async () => {
    mockDeleteDoc.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(deleteClipComment("p1", "uc1", "c9")).rejects.toThrow(/denied/);

    expect(warn).toHaveBeenCalledWith("clip_comment_delete_failed", expect.objectContaining({ commentId: "c9" }));
    warn.mockRestore();
  });
});

/* ── fetchClipComments ──────────────────────────────────────── */

describe("fetchClipComments", () => {
  it("orders newest first with a doc-id tiebreaker and returns a cursor", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [commentSnap("c1", validComment()), commentSnap("c2", validComment({ text: "clean" }))],
    });

    const page = await fetchClipComments("uc1");

    expect(mockOrderBy).toHaveBeenCalledWith("createdAt", "desc");
    expect(mockOrderBy).toHaveBeenCalledWith("__name__", "desc");
    expect(mockLimit).toHaveBeenCalledWith(20);
    expect(mockStartAfter).not.toHaveBeenCalled();
    expect(page.comments.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(page.comments[0]).toMatchObject({ clipId: "uc1", userId: "p1", username: "alice", text: "sick" });
    expect(page.cursor).toEqual({ createdAt: expect.objectContaining({ toMillis: expect.any(Function) }), id: "c2" });
  });

  it("applies a supplied cursor via startAfter(createdAt, id)", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    const cursor: ClipCommentsCursor = {
      createdAt: ts(1_700_000_000_000) as unknown as ClipCommentsCursor["createdAt"],
      id: "c2",
    };

    const page = await fetchClipComments("uc1", cursor);

    expect(mockStartAfter).toHaveBeenCalledWith(cursor.createdAt, "c2");
    expect(page.cursor).toBeNull();
  });

  it("clamps the page size to the 1..50 band", async () => {
    await fetchClipComments("uc1", null, 500);
    expect(mockLimit).toHaveBeenCalledWith(50);

    await fetchClipComments("uc1", null, 0);
    expect(mockLimit).toHaveBeenCalledWith(1);
  });

  it("skips a malformed comment instead of blanking the thread", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        commentSnap("empty", undefined),
        commentSnap("no-author", { text: "hi" }),
        commentSnap("no-text", { userId: "p1" }),
        commentSnap("ok", validComment()),
      ],
    });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const page = await fetchClipComments("uc1");

    expect(page.comments.map((c) => c.id)).toEqual(["ok"]);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("advances the cursor off the last RAW doc even when it is the unparseable one", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        commentSnap("ok", validComment()),
        commentSnap("bad", { text: "no author", createdAt: ts(1_700_000_000_001) }),
      ],
    });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const page = await fetchClipComments("uc1");

    // Pagination must not stall on a window with a bad trailing row.
    expect(page.cursor).toEqual({ createdAt: expect.objectContaining({ toMillis: expect.any(Function) }), id: "bad" });
    warn.mockRestore();
  });

  it("returns a null cursor when the last doc has no usable timestamp", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [commentSnap("pending", validComment({ createdAt: undefined }))],
    });

    const page = await fetchClipComments("uc1");

    expect(page.comments[0].createdAt).toBeNull();
    expect(page.cursor).toBeNull();
  });

  it("rejects an unusable clip id without a read", async () => {
    await expect(fetchClipComments("a/b")).rejects.toThrow(/Invalid clip id/);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });
});

/* ── toClipComment ──────────────────────────────────────────── */

describe("toClipComment", () => {
  it("keeps a duck-typed Timestamp and falls back to '' for a missing username", () => {
    const mapped = toClipComment(
      "uc1",
      commentSnap("c1", { userId: "p1", text: "hi", createdAt: { toMillis: () => 1 } }),
    );

    expect(mapped.username).toBe("");
    expect(mapped.createdAt).not.toBeNull();
  });

  it("passes a real Timestamp instance straight through", () => {
    // The `instanceof Timestamp` fast path, as taken by every snapshot that
    // came off the wire rather than out of a test double.
    const stamp = new (Timestamp as unknown as new () => object)();

    const mapped = toClipComment("uc1", commentSnap("c1", { userId: "p1", text: "hi", createdAt: stamp }));

    expect(mapped.createdAt).toBe(stamp);
  });

  it("throws on a body with no data at all", () => {
    expect(() => toClipComment("uc1", commentSnap("c1", undefined))).toThrow(/Malformed clip comment/);
  });
});
