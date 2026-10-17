import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWttItems, submitWttVote, fetchWttReliability, subscribeToWttReliability, submitProReview } from "../wtt";

const mockDb = {
  collection: vi.fn(),
};

const mockAuth = {
  currentUser: { uid: "test-uid" },
};

vi.mock("../../firebase", () => ({
  requireDb: () => mockDb,
  requireAuth: () => mockAuth,
}));

vi.mock("firebase/firestore", () => ({
  collection: vi.fn((db: unknown, path: string) => ({ path })),
  query: vi.fn((...args: unknown[]) => ({ queryArgs: args })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  orderBy: vi.fn((field: string) => ({ orderBy: field })),
  limit: vi.fn((n: number) => ({ limit: n })),
  getDocs: vi.fn(),
  doc: vi.fn((db: unknown, path: string, id: string) => ({ path, id })),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(() => "SERVER_TIMESTAMP"),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("fetchWttItems", () => {
  it("returns empty array when no items found", async () => {
    const { getDocs } = await import("firebase/firestore");
    vi.mocked(getDocs).mockResolvedValue({
      docs: [],
    } as never);

    const result = await fetchWttItems("user123", 10);
    expect(result).toEqual([]);
  });

  it("returns items from Firestore", async () => {
    const { getDocs } = await import("firebase/firestore");
    vi.mocked(getDocs).mockResolvedValue({
      docs: [
        {
          id: "clip1",
          data: () => ({
            clipId: "clip1",
            correctTrickId: "kickflip",
            options: ["kickflip", "heelflip", "impossible", "bigflip"],
            voteCount: 2,
            retired: false,
          }),
        },
      ],
    } as never);

    const result = await fetchWttItems("user123", 10);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      clipId: "clip1",
      correctTrickId: "kickflip",
    });
  });
});

describe("submitWttVote", () => {
  it("throws when user is not authenticated", async () => {
    const mockAuthNoUser = { currentUser: null };
    vi.doMock("../../firebase", () => ({
      requireDb: () => mockDb,
      requireAuth: () => mockAuthNoUser,
    }));

    await expect(submitWttVote("clip123", "user123", "kickflip")).rejects.toThrow("Not authenticated");
  });

  it("submits vote to Firestore", async () => {
    const { setDoc } = await import("firebase/firestore");
    vi.mocked(setDoc).mockResolvedValue(undefined);

    await submitWttVote("clip123", "test-uid", "kickflip");

    expect(setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: "wttVotes", id: "clip123_test-uid" }),
      expect.objectContaining({
        clipId: "clip123",
        uid: "test-uid",
        choice: "kickflip",
        createdAt: "SERVER_TIMESTAMP",
      }),
    );
  });
});

describe("fetchWttReliability", () => {
  it("returns null when doc does not exist", async () => {
    const { getDoc } = await import("firebase/firestore");
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => false,
    } as never);

    const result = await fetchWttReliability("user123");
    expect(result).toBeNull();
  });

  it("returns reliability data when doc exists", async () => {
    const { getDoc } = await import("firebase/firestore");
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({
        reliabilityScore: 0.85,
        votesSubmitted: 10,
        goldCorrect: 8,
      }),
    } as never);

    const result = await fetchWttReliability("user123");
    expect(result).toMatchObject({
      reliabilityScore: 0.85,
      votesSubmitted: 10,
      goldCorrect: 8,
    });
  });
});

describe("subscribeToWttReliability", () => {
  it("calls onSnapshot with correct doc ref", async () => {
    const { onSnapshot } = await import("firebase/firestore");
    const callback = vi.fn();

    subscribeToWttReliability("user123", callback);

    expect(onSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ path: "users/user123/private", id: "wtt" }),
      expect.any(Function),
    );
  });

  it("calls callback with null when doc doesn't exist", async () => {
    const { onSnapshot } = await import("firebase/firestore");
    const callback = vi.fn();

    subscribeToWttReliability("user123", callback);

    const snapshotHandler = onSnapshot.mock.calls[0][1] as (snap: { exists: () => boolean }) => void;
    snapshotHandler({ exists: () => false });

    expect(callback).toHaveBeenCalledWith(null);
  });

  it("calls callback with data when doc exists", async () => {
    const { onSnapshot } = await import("firebase/firestore");
    const callback = vi.fn();

    subscribeToWttReliability("user123", callback);

    const snapshotHandler = onSnapshot.mock.calls[0][1] as (snap: {
      exists: () => boolean;
      data: () => unknown;
    }) => void;
    snapshotHandler({
      exists: () => true,
      data: () => ({ reliabilityScore: 0.9, votesSubmitted: 15, goldCorrect: 14 }),
    });

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        reliabilityScore: 0.9,
        votesSubmitted: 15,
        goldCorrect: 14,
      }),
    );
  });
});

describe("submitProReview", () => {
  it("throws when user is not authenticated", async () => {
    const mockAuthNoUser = { currentUser: null };
    vi.doMock("../../firebase", () => ({
      requireDb: () => mockDb,
      requireAuth: () => mockAuthNoUser,
    }));

    await expect(submitProReview("clip123", "user123", "kickflip", "Clean")).rejects.toThrow("Not authenticated");
  });

  it("submits pro review to Firestore", async () => {
    const { setDoc, doc } = await import("firebase/firestore");
    vi.mocked(setDoc).mockResolvedValue(undefined);
    vi.mocked(doc).mockReturnValue({ path: "proReviews" } as never);

    await submitProReview("clip123", "test-uid", "kickflip", "Clean kickflip");

    expect(setDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        clipId: "clip123",
        reviewerUid: "test-uid",
        answerTrickId: "kickflip",
        note: "Clean kickflip",
        createdAt: "SERVER_TIMESTAMP",
      }),
    );
  });
});
