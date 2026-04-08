import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/firestore ────────────────── */
const {
  mockGetDoc,
  mockGetDocs,
  mockSetDoc,
  mockDeleteDoc,
  mockDoc,
  mockCollection,
  mockOnSnapshot,
  mockServerTimestamp,
} = vi.hoisted(() => ({
  mockGetDoc: vi.fn(),
  mockGetDocs: vi.fn(),
  mockSetDoc: vi.fn().mockResolvedValue(undefined),
  mockDeleteDoc: vi.fn().mockResolvedValue(undefined),
  mockDoc: vi.fn((_db: unknown, ...pathSegments: string[]) => pathSegments.join("/")),
  mockCollection: vi.fn((_db: unknown, ...pathSegments: string[]) => pathSegments.join("/")),
  mockOnSnapshot: vi.fn(),
  mockServerTimestamp: vi.fn(() => "SERVER_TS"),
}));

vi.mock("firebase/firestore", () => ({
  collection: mockCollection,
  doc: mockDoc,
  deleteDoc: mockDeleteDoc,
  getDoc: mockGetDoc,
  getDocs: mockGetDocs,
  setDoc: mockSetDoc,
  onSnapshot: mockOnSnapshot,
  serverTimestamp: () => mockServerTimestamp(),
}));

vi.mock("../../firebase");

import {
  blockUser,
  unblockUser,
  isUserBlocked,
  isEitherBlocked,
  getBlockedUsers,
  subscribeToBlockedUsers,
} from "../block";

beforeEach(() => vi.clearAllMocks());

/* ── Tests ──────────────────────────────────── */

describe("block service", () => {
  describe("blockUser", () => {
    it("creates a block record in the subcollection", async () => {
      await blockUser("blocker1", "blocked1", "blocked_user");

      expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "users", "blocker1", "blockedUsers", "blocked1");
      expect(mockSetDoc).toHaveBeenCalledWith(
        "users/blocker1/blockedUsers/blocked1",
        expect.objectContaining({
          blockedUid: "blocked1",
          blockedUsername: "blocked_user",
          createdAt: "SERVER_TS",
        }),
      );
    });

    it("throws when trying to block yourself", async () => {
      await expect(blockUser("u1", "u1", "self")).rejects.toThrow("You cannot block yourself");
      expect(mockSetDoc).not.toHaveBeenCalled();
    });
  });

  describe("unblockUser", () => {
    it("deletes the block record from the subcollection", async () => {
      await unblockUser("blocker1", "blocked1");

      expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "users", "blocker1", "blockedUsers", "blocked1");
      expect(mockDeleteDoc).toHaveBeenCalledWith("users/blocker1/blockedUsers/blocked1");
    });
  });

  describe("isUserBlocked", () => {
    it("returns true when block record exists", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => true });
      const result = await isUserBlocked("blocker1", "blocked1");
      expect(result).toBe(true);
    });

    it("returns false when block record does not exist", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => false });
      const result = await isUserBlocked("blocker1", "blocked1");
      expect(result).toBe(false);
    });
  });

  describe("isEitherBlocked", () => {
    it("returns true when first user blocked second", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => true }).mockResolvedValueOnce({ exists: () => false });
      expect(await isEitherBlocked("u1", "u2")).toBe(true);
    });

    it("returns true when second user blocked first", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => false }).mockResolvedValueOnce({ exists: () => true });
      expect(await isEitherBlocked("u1", "u2")).toBe(true);
    });

    it("returns false when neither has blocked the other", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => false }).mockResolvedValueOnce({ exists: () => false });
      expect(await isEitherBlocked("u1", "u2")).toBe(false);
    });

    it("returns true when both have blocked each other", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => true }).mockResolvedValueOnce({ exists: () => true });
      expect(await isEitherBlocked("u1", "u2")).toBe(true);
    });
  });

  describe("getBlockedUsers", () => {
    it("returns all blocked user records", async () => {
      const records = [
        { blockedUid: "u2", blockedUsername: "user2", createdAt: null },
        { blockedUid: "u3", blockedUsername: "user3", createdAt: null },
      ];
      mockGetDocs.mockResolvedValueOnce({
        docs: records.map((r) => ({ data: () => r })),
      });

      const result = await getBlockedUsers("u1");
      expect(result).toEqual(records);
      expect(mockCollection).toHaveBeenCalledWith(expect.anything(), "users", "u1", "blockedUsers");
    });

    it("returns empty array when no users are blocked", async () => {
      mockGetDocs.mockResolvedValueOnce({ docs: [] });
      const result = await getBlockedUsers("u1");
      expect(result).toEqual([]);
    });
  });

  describe("subscribeToBlockedUsers", () => {
    it("calls onUpdate with blocked UIDs from snapshot", () => {
      const callback = vi.fn();
      mockOnSnapshot.mockImplementation((_ref: unknown, onNext: Function) => {
        onNext({
          docs: [{ data: () => ({ blockedUid: "u2" }) }, { data: () => ({ blockedUid: "u3" }) }],
        });
        return vi.fn();
      });

      subscribeToBlockedUsers("u1", callback);

      expect(callback).toHaveBeenCalledWith(new Set(["u2", "u3"]));
    });

    it("returns unsubscribe function", () => {
      const unsub = vi.fn();
      mockOnSnapshot.mockReturnValue(unsub);

      const result = subscribeToBlockedUsers("u1", vi.fn());
      expect(result).toBe(unsub);
    });

    it("filters out non-string blockedUid values", () => {
      const callback = vi.fn();
      mockOnSnapshot.mockImplementation((_ref: unknown, onNext: Function) => {
        onNext({
          docs: [{ data: () => ({ blockedUid: "u2" }) }, { data: () => ({ blockedUid: 123 }) }, { data: () => ({}) }],
        });
        return vi.fn();
      });

      subscribeToBlockedUsers("u1", callback);

      expect(callback).toHaveBeenCalledWith(new Set(["u2"]));
    });

    it("handles snapshot errors gracefully", () => {
      const callback = vi.fn();
      mockOnSnapshot.mockImplementation((_ref: unknown, _onNext: Function, onError: Function) => {
        onError(new Error("permission denied"));
        return vi.fn();
      });

      // Should not throw — error is logged internally
      subscribeToBlockedUsers("u1", callback);

      expect(callback).not.toHaveBeenCalled();
    });
  });
});
