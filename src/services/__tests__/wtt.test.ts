import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchWttItems, submitWttVote, fetchWttReliability, subscribeToWttReliability, submitProReview } from "../wtt";

const mockGetDocs = vi.fn();
const mockGetDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockOnSnapshot = vi.fn();
const mockCollection = vi.fn();
const mockDoc = vi.fn();
const mockQuery = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockTimestampNow = vi.fn(() => ({ seconds: 1697500000, nanoseconds: 0 }));
const mockTimestampToDate = vi.fn(() => new Date("2026-10-17T10:00:00Z"));

const mockDb = { name: "test-db" };

vi.mock("../../firebase", () => ({
  requireDb: () => mockDb,
}));

vi.mock("firebase/firestore", () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  limit: (...args: unknown[]) => mockLimit(...args),
  Timestamp: {
    now: () => mockTimestampNow(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCollection.mockReturnValue({ _type: "collection" });
  mockDoc.mockReturnValue({ _type: "doc" });
  mockQuery.mockReturnValue({ _type: "query" });
  mockWhere.mockReturnValue({ _type: "where" });
  mockOrderBy.mockReturnValue({ _type: "orderBy" });
  mockLimit.mockReturnValue({ _type: "limit" });
});

const makeMockClipDoc = (overrides?: Record<string, unknown>) => ({
  id: "clip1",
  data: () => ({
    trickFamily: "kickflip",
    options: ["kickflip", "heelflip", "impossible", "bigflip"],
    status: "open",
    voteCount: 2,
    weightedTally: { kickflip: 1.5, heelflip: 0.5 },
    top: "kickflip",
    topPosterior: 0.75,
    createdAt: { toDate: mockTimestampToDate },
    ...overrides,
  }),
});

const makeMockReliabilityData = (overrides?: Record<string, unknown>) => ({
  reliability: { kickflip: 0.85, heelflip: 0.9 },
  goldSeen: 20,
  goldCorrect: 18,
  trickIq: 90,
  streakDays: 5,
  lastAnsweredDay: "2026-10-17",
  freezesLeft: 2,
  ...overrides,
});

describe("fetchWttItems", () => {
  it("returns empty array when no items found", async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });

    const result = await fetchWttItems("user123", 10);
    expect(result).toEqual([]);
    expect(mockGetDocs).toHaveBeenCalled();
  });

  it("returns items user hasn't voted on", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeMockClipDoc()],
    });

    mockGetDoc.mockResolvedValue({ exists: () => false });

    const result = await fetchWttItems("user123", 10);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      clipId: "clip1",
      trickFamily: "kickflip",
      status: "open",
      voteCount: 2,
    });
    expect(mockGetDoc).toHaveBeenCalled();
  });

  it("excludes items user already voted on", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeMockClipDoc()],
    });

    mockGetDoc.mockResolvedValue({ exists: () => true });

    const result = await fetchWttItems("user123", 10);

    expect(result).toHaveLength(0);
  });

  it("handles items with retiredAt timestamp", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        makeMockClipDoc({
          status: "retired",
          voteCount: 10,
          retiredAt: { toDate: mockTimestampToDate },
        }),
      ],
    });

    mockGetDoc.mockResolvedValue({ exists: () => false });

    const result = await fetchWttItems("user123", 10);

    expect(result).toHaveLength(1);
    expect(result[0].retiredAt).toBeInstanceOf(Date);
  });

  it("handles items without optional fields", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        {
          id: "clip1",
          data: () => ({
            trickFamily: "kickflip",
            options: ["kickflip", "heelflip", "impossible", "bigflip"],
            status: "open",
            createdAt: { toDate: mockTimestampToDate },
          }),
        },
      ],
    });

    mockGetDoc.mockResolvedValue({ exists: () => false });

    const result = await fetchWttItems("user123", 10);

    expect(result).toHaveLength(1);
    expect(result[0].voteCount).toBe(0);
    expect(result[0].weightedTally).toEqual({});
    expect(result[0].top).toBeNull();
    expect(result[0].topPosterior).toBe(0);
  });
});

describe("submitWttVote", () => {
  it("submits vote with correct structure", async () => {
    mockSetDoc.mockResolvedValue(undefined);

    await submitWttVote("clip123", "user456", "kickflip");

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ _type: "doc" }),
      expect.objectContaining({
        clipId: "clip123",
        uid: "user456",
        choice: "kickflip",
        createdAt: expect.anything(),
      }),
    );
  });

  it("handles special choices like unsure and not_landed", async () => {
    mockSetDoc.mockResolvedValue(undefined);

    await submitWttVote("clip123", "user456", "unsure");
    await submitWttVote("clip123", "user456", "not_landed");

    expect(mockSetDoc).toHaveBeenCalledTimes(2);
  });
});

describe("fetchWttReliability", () => {
  it("returns null when doc does not exist", async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });

    const result = await fetchWttReliability("user123");
    expect(result).toBeNull();
  });

  it("returns reliability data with all fields", async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => makeMockReliabilityData(),
    });

    const result = await fetchWttReliability("user123");

    expect(result).toMatchObject(makeMockReliabilityData());
  });

  it("returns defaults for missing fields", async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({}),
    });

    const result = await fetchWttReliability("user123");

    expect(result).toMatchObject({
      reliability: {},
      goldSeen: 0,
      goldCorrect: 0,
      trickIq: 0,
      streakDays: 0,
      lastAnsweredDay: null,
      freezesLeft: 1,
    });
  });
});

describe("subscribeToWttReliability", () => {
  it("calls callback with null when doc doesn't exist", () => {
    const callback = vi.fn();
    mockOnSnapshot.mockImplementation((_docRef, onNext) => {
      onNext({ exists: () => false });
      return vi.fn();
    });

    subscribeToWttReliability("user123", callback);

    expect(callback).toHaveBeenCalledWith(null);
  });

  it("calls callback with reliability data when doc exists", () => {
    const callback = vi.fn();
    mockOnSnapshot.mockImplementation((_docRef, onNext) => {
      onNext({
        exists: () => true,
        data: () =>
          makeMockReliabilityData({
            goldSeen: 15,
            goldCorrect: 14,
            trickIq: 93,
            streakDays: 3,
            lastAnsweredDay: "2026-10-16",
          }),
      });
      return vi.fn();
    });

    subscribeToWttReliability("user123", callback);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        goldSeen: 15,
        goldCorrect: 14,
        trickIq: 93,
      }),
    );
  });

  it("calls callback with null on error", () => {
    const callback = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockOnSnapshot.mockImplementation((_docRef, _onNext, onError) => {
      onError?.(new Error("Firestore error"));
      return vi.fn();
    });

    subscribeToWttReliability("user123", callback);

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null);

    consoleErrorSpy.mockRestore();
  });

  it("returns an unsubscribe function", () => {
    const unsubscribeMock = vi.fn();
    mockOnSnapshot.mockReturnValue(unsubscribeMock);

    const unsubscribe = subscribeToWttReliability("user123", vi.fn());

    expect(typeof unsubscribe).toBe("function");
    expect(unsubscribe).toBe(unsubscribeMock);
  });
});

describe("submitProReview", () => {
  const expectProReviewCall = (overrides?: Record<string, unknown>) => {
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        clipId: "clip789",
        uid: "pro123",
        answerTrickId: "kickflip",
        createdAt: expect.anything(),
        ...overrides,
      }),
    );
  };

  it("submits pro review with note", async () => {
    mockSetDoc.mockResolvedValue(undefined);

    await submitProReview("clip789", "pro123", "kickflip", "Clean execution");

    expectProReviewCall({ note: "Clean execution" });
  });

  it("submits pro review without note", async () => {
    mockSetDoc.mockResolvedValue(undefined);

    await submitProReview("clip789", "pro123", "kickflip");

    expectProReviewCall();

    const callArgs = mockSetDoc.mock.calls[0][1] as Record<string, unknown>;
    expect("note" in callArgs).toBe(false);
  });
});
