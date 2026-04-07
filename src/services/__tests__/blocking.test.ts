import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockDeleteDoc = vi.fn().mockResolvedValue(undefined);
const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockDoc = vi.fn((_db: unknown, ...pathSegments: string[]) => pathSegments.join("/"));
const mockCollection = vi.fn((_db: unknown, ...pathSegments: string[]) => pathSegments.join("/"));
const mockServerTimestamp = vi.fn(() => "SERVER_TS");

vi.mock("firebase/firestore", () => ({
  doc: (...args: unknown[]) => mockDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  serverTimestamp: () => mockServerTimestamp(),
}));

vi.mock("../../firebase");

import { blockUser, unblockUser, isUserBlocked, getBlockedUserIds } from "../blocking";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("blockUser", () => {
  it("writes a block doc to the blocked_users subcollection", async () => {
    await blockUser("blocker1", "blocked1");

    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "users", "blocker1", "blocked_users", "blocked1");
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        blockedUid: "blocked1",
        createdAt: "SERVER_TS",
      }),
    );
  });

  it("throws if blocker tries to block themselves", async () => {
    await expect(blockUser("user1", "user1")).rejects.toThrow("You cannot block yourself");
  });

  it("throws if blockerUid is empty", async () => {
    await expect(blockUser("", "blocked1")).rejects.toThrow("Missing user ID");
  });

  it("throws if blockedUid is empty", async () => {
    await expect(blockUser("blocker1", "")).rejects.toThrow("Missing user ID");
  });

  it("throws a user-friendly message when setDoc fails", async () => {
    mockSetDoc.mockRejectedValueOnce(new Error("Firestore unavailable"));
    await expect(blockUser("blocker1", "blocked1")).rejects.toThrow("Failed to block user");
  });
});

describe("unblockUser", () => {
  it("deletes the block doc from the blocked_users subcollection", async () => {
    await unblockUser("blocker1", "blocked1");

    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "users", "blocker1", "blocked_users", "blocked1");
    expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
  });

  it("throws if blockerUid is empty", async () => {
    await expect(unblockUser("", "blocked1")).rejects.toThrow("Missing user ID");
  });

  it("throws if blockedUid is empty", async () => {
    await expect(unblockUser("blocker1", "")).rejects.toThrow("Missing user ID");
  });

  it("throws a user-friendly message when deleteDoc fails", async () => {
    mockDeleteDoc.mockRejectedValueOnce(new Error("Firestore unavailable"));
    await expect(unblockUser("blocker1", "blocked1")).rejects.toThrow("Failed to unblock user");
  });
});

describe("isUserBlocked", () => {
  it("returns true when block doc exists", async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true });
    const result = await isUserBlocked("blocker1", "target1");
    expect(result).toBe(true);
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "users", "blocker1", "blocked_users", "target1");
  });

  it("returns false when block doc does not exist", async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });
    const result = await isUserBlocked("blocker1", "target1");
    expect(result).toBe(false);
  });

  it("returns false when blockerUid is empty", async () => {
    const result = await isUserBlocked("", "target1");
    expect(result).toBe(false);
    expect(mockGetDoc).not.toHaveBeenCalled();
  });

  it("returns false when targetUid is empty", async () => {
    const result = await isUserBlocked("blocker1", "");
    expect(result).toBe(false);
    expect(mockGetDoc).not.toHaveBeenCalled();
  });

  it("returns false on Firestore error", async () => {
    mockGetDoc.mockRejectedValueOnce(new Error("Network error"));
    const result = await isUserBlocked("blocker1", "target1");
    expect(result).toBe(false);
  });
});

describe("getBlockedUserIds", () => {
  it("returns a Set of blocked UIDs", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ id: "blocked1" }, { id: "blocked2" }, { id: "blocked3" }],
    });

    const result = await getBlockedUserIds("user1");
    expect(result).toEqual(new Set(["blocked1", "blocked2", "blocked3"]));
    expect(mockCollection).toHaveBeenCalledWith(expect.anything(), "users", "user1", "blocked_users");
  });

  it("returns empty Set when no blocked users", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    const result = await getBlockedUserIds("user1");
    expect(result).toEqual(new Set());
  });

  it("returns empty Set when uid is empty", async () => {
    const result = await getBlockedUserIds("");
    expect(result).toEqual(new Set());
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("returns empty Set on Firestore error", async () => {
    mockGetDocs.mockRejectedValueOnce(new Error("Network error"));
    const result = await getBlockedUserIds("user1");
    expect(result).toEqual(new Set());
  });
});
